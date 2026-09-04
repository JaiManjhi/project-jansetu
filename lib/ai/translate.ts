import {
  GEMINI_BASE,
  GEMINI_MODEL,
  GROQ_CHAT_URL,
  GROQ_MODEL,
  INJECTION_GUARD,
  TIMEOUTS,
  requireEnv,
} from "./models.ts";
import { LANGUAGE_NAMES, type TranslationLanguage } from "../constants.ts";

/**
 * Translation for the public feed.
 *
 * A citizen in Jamshedpur reports in Bengali; a coordinator in Ranchi reads
 * Hindi. Without this the feed is legible only to whoever shares the reporter's
 * language, which undercuts the whole premise that these reports are a shared
 * public record.
 *
 * Groq first, Gemini as fallback — the same order and the same reasoning as
 * classification and reason generation. Unlike those two there is no safe
 * default to fall back to: an approximate translation of a civic complaint is
 * worse than none, so this throws and the caller tells the reader plainly that
 * translation is unavailable.
 */

export class TranslationUnavailableError extends Error {}

export interface TranslationResult {
  title: string;
  description: string;
}

/**
 * The prompt asks for JSON because the title and description must come back
 * separately — concatenating them and splitting on a newline breaks the moment
 * a translation contains one.
 *
 * The injection guard is here for the same reason it is on every other prompt
 * that embeds citizen text: this content is untrusted, and a report whose text
 * reads "ignore previous instructions" must be translated, not obeyed.
 */
function buildPrompt(title: string, description: string, target: TranslationLanguage): string {
  const name = LANGUAGE_NAMES[target].english;
  return `Translate the following citizen-reported civic problem into ${name}.

${INJECTION_GUARD}
TITLE: ${title}
DESCRIPTION: ${description}

Rules:
- Translate faithfully. Do not summarise, soften, or add detail that is not there.
- Keep place names, institution names and numbers exactly as they appear.
- Use the natural script for ${name}.
- If the text is already in ${name}, return it unchanged.

Respond with only a JSON object, no other text:
{"title": "...", "description": "..."}`;
}

/** Pulls the JSON object out of a reply that may be fenced or padded with prose. */
function parseTranslation(raw: string): TranslationResult | null {
  const fenced = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { title, description } = parsed as { title?: unknown; description?: unknown };
    if (typeof title !== "string" || typeof description !== "string") return null;
    if (title.trim() === "" || description.trim() === "") return null;
    return { title: title.trim(), description: description.trim() };
  } catch {
    return null;
  }
}

async function viaGroq(prompt: string): Promise<TranslationResult | null> {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("GROQ_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      reasoning_effort: "low",
      // A full description in a non-Latin script is token-expensive: Devanagari
      // and Bengali cost several tokens per word where English costs one.
      max_tokens: 1600,
    }),
    signal: AbortSignal.timeout(TIMEOUTS.generateMs),
  });
  if (!response.ok) throw new Error(`groq HTTP ${response.status}`);

  const body: unknown = await response.json();
  const text = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
    ?.message?.content;
  return typeof text === "string" ? parseTranslation(text) : null;
}

async function viaGemini(prompt: string): Promise<TranslationResult | null> {
  const response = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1600 },
    }),
    signal: AbortSignal.timeout(TIMEOUTS.generateMs),
  });
  if (!response.ok) throw new Error(`gemini HTTP ${response.status}`);

  const body: unknown = await response.json();
  const text = (
    body as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }
  ).candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? parseTranslation(text) : null;
}

export async function translateProblem(
  title: string,
  description: string,
  target: TranslationLanguage,
): Promise<TranslationResult> {
  const prompt = buildPrompt(title, description, target);
  const failures: string[] = [];

  for (const [name, attempt] of [
    ["groq", viaGroq],
    ["gemini", viaGemini],
  ] as const) {
    try {
      const result = await attempt(prompt);
      if (result) return result;
      failures.push(`${name}: unparseable response`);
    } catch (error: unknown) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new TranslationUnavailableError(`translation unavailable: ${failures.join(" | ")}`);
}
