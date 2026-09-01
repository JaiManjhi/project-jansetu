import { z } from "zod";
// Relative, not the "@/" alias: scripts and tests run under plain node, which
// does not read tsconfig paths. See ARCHITECTURE.md §5.
import { CATEGORY_ENUM, FALLBACK_CATEGORY, type Category } from "../constants.ts";
import {
  GEMINI_BASE,
  GEMINI_MODEL,
  GROQ_CHAT_URL,
  GROQ_MODEL,
  INJECTION_GUARD,
  TIMEOUTS,
  requireEnv,
} from "./models.ts";

/**
 * Classification — AI_ENGINE.md §1.
 *
 * Groq primary for latency, Gemini Flash fallback. Invalid response retries
 * once with a stricter reminder. If everything fails the caller is told, and
 * POST /api/problems saves the submission anyway with needsReview: true —
 * never losing a citizen's report is a hard requirement (§7).
 */

/**
 * Copied verbatim from AI_ENGINE.md §1. If you change a word here, change it
 * there in the same commit — the doc and the code must stay identical, and the
 * category list must match CATEGORY_ENUM or every answer fails validation and
 * silently falls back.
 */
const SYSTEM_PROMPT = `You are a civic-problem classifier for an Indian public-infrastructure reporting platform.
Classify the following citizen-submitted problem into EXACTLY ONE of these categories:
water_resources, healthcare, education, agriculture, environment, energy,
urban_infrastructure, accessibility, public_administration, rural_livelihoods

Also assign a severity score from 0-100 based on:
- Immediacy of harm (a health/safety risk scores higher than a convenience issue)
- Number of people likely affected (shared infrastructure scores higher than individual)
- Duration implied (a problem stated as ongoing for months scores higher than a one-time event)

Respond ONLY with valid JSON in this exact shape, no other text:
{"category": "...", "severityScore": 0, "reasoning": "one short sentence"}`;

/** Appended on the single retry when the first answer failed validation. */
const STRICT_REMINDER = `

REMINDER: Your previous response was not valid. Respond with ONLY a JSON object, no prose, no markdown fences.
"category" must be exactly one of: ${CATEGORY_ENUM.join(", ")}
"severityScore" must be an integer between 0 and 100.`;

const ClassificationSchema = z.object({
  category: z.enum(CATEGORY_ENUM),
  severityScore: z.number().int().min(0).max(100),
  reasoning: z.string().default(""),
});

export interface Classification {
  category: Category;
  severityScore: number;
  reasoning: string;
  /** Which provider answered, and whether the safe default was used. Logged
   *  so classification quality can be audited after the demo. */
  provider: "groq" | "gemini" | "fallback-default";
}

export class ClassificationUnavailableError extends Error {
  constructor(cause: string) {
    super(`classification unavailable: ${cause}`);
    this.name = "ClassificationUnavailableError";
  }
}

/** Models sometimes wrap JSON in markdown fences despite being told not to. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function parseClassification(raw: string): z.infer<typeof ClassificationSchema> {
  const parsed: unknown = JSON.parse(stripFences(raw));
  return ClassificationSchema.parse(parsed);
}

async function callGroq(systemPrompt: string, userText: string): Promise<string> {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("GROQ_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: INJECTION_GUARD + userText },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(TIMEOUTS.generateMs),
  });

  if (!response.ok) {
    throw new Error(`groq HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`);
  }

  const body: unknown = await response.json();
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("groq returned no message content");
  return content;
}

async function callGemini(systemPrompt: string, userText: string): Promise<string> {
  const response = await fetch(
    `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: INJECTION_GUARD + userText }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(TIMEOUTS.generateMs),
    },
  );

  if (!response.ok) {
    throw new Error(`gemini HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`);
  }

  const body: unknown = await response.json();
  const content = (body as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  }).candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== "string") throw new Error("gemini returned no candidate text");
  return content;
}

type Provider = (systemPrompt: string, userText: string) => Promise<string>;

/** The provider could not be reached, or refused the request. */
class TransportFailure extends Error {}
/** The provider answered, but the answer was not valid or not in-enum. */
class InvalidOutput extends Error {}

/**
 * Tries one provider twice: once normally, once with the stricter reminder if
 * the answer failed validation. A transport failure does not get a retry here
 * — that is what the other provider is for.
 *
 * The two failure modes are distinguished by TYPE rather than by matching on
 * error message text, because they mean opposite things downstream: a bad
 * answer means take the safe default and flag for review, while an outage
 * means save with no category at all (§1 vs §7).
 */
async function attempt(
  provider: Provider,
  description: string,
): Promise<z.infer<typeof ClassificationSchema>> {
  let first: string;
  try {
    first = await provider(SYSTEM_PROMPT, description);
  } catch (error: unknown) {
    throw new TransportFailure(error instanceof Error ? error.message : String(error));
  }

  try {
    return parseClassification(first);
  } catch {
    let second: string;
    try {
      second = await provider(SYSTEM_PROMPT + STRICT_REMINDER, description);
    } catch (error: unknown) {
      throw new TransportFailure(error instanceof Error ? error.message : String(error));
    }
    try {
      return parseClassification(second);
    } catch (error: unknown) {
      throw new InvalidOutput(error instanceof Error ? error.message : String(error));
    }
  }
}

/**
 * Classifies a problem description.
 *
 * Resolution order per §1: Groq (with one strict retry) → Gemini (with one
 * strict retry) → the safe default. Only a total provider outage throws.
 */
export async function classifyProblem(
  description: string,
): Promise<Classification> {
  const text = description.trim();
  if (!text) throw new ClassificationUnavailableError("empty description");

  const failures: string[] = [];
  let anyProviderAnswered = false;

  for (const [name, provider] of [
    ["groq", callGroq],
    ["gemini", callGemini],
  ] as const) {
    try {
      const result = await attempt(provider, text);
      return { ...result, provider: name };
    } catch (error: unknown) {
      if (error instanceof InvalidOutput) anyProviderAnswered = true;
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (anyProviderAnswered) {
    // A provider was reachable but could not produce a valid, in-enum answer
    // even after the strict retry. §1: take the safe default and flag for
    // manual review rather than dropping the submission.
    return {
      category: FALLBACK_CATEGORY,
      severityScore: 50,
      reasoning: "Automatic classification failed; flagged for manual review.",
      provider: "fallback-default",
    };
  }

  // Nothing was reachable at all — §7. The caller saves the problem with no
  // category and needsReview: true. It must not surface as an error response.
  throw new ClassificationUnavailableError(failures.join(" | "));
}
