import type { Types } from "mongoose";
import { Institution } from "../../models/Institution.ts";
import { cosineSimilarity } from "./embed.ts";
import { haversineKm } from "../geo/haversine.ts";
import { atlasScoreToCosine } from "./dedup.ts";
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
 * Routing / matching — AI_ENGINE.md §4.
 *
 * Runs last, only for problems that are not duplicates. Produces the top 3
 * institutions with a plain-language reason for each, because PRD §6 requires
 * a coordinator to see WHY they were matched, not just a score.
 */

/** finalScore = 0.7·cosine − 0.3·distancePenalty, per §4. */
const SIMILARITY_WEIGHT = 0.7;
const DISTANCE_WEIGHT = 0.3;

/** Distance penalty saturates here, so a distant perfect match is not zeroed. */
const DISTANCE_SATURATION_KM = 300;

/** Load-balancing penalty per active project, capped so it stays a tie-breaker. */
const LOAD_PENALTY_PER_PROJECT = 0.02;
const LOAD_PENALTY_CAP = 0.1;

/**
 * Retrieval pool, deliberately much wider than the 10 in §4.
 *
 * The institution vector is an average over every department, so a large
 * multi-disciplinary institution gets a mushy vector that matches nothing
 * strongly. Measured on real seeded data: for a water-supply problem, the
 * nearest institution with actual relevant capability ranked **#23** by
 * institution vector alone — far outside a pool of 10, so no amount of
 * re-scoring could have recovered it. A wide pool plus department-level
 * re-scoring puts it at #1.
 */
const CANDIDATE_POOL = 50;
const RESULT_COUNT = 3;

export interface MatchResult {
  institutionId: string;
  institutionName: string;
  score: number;
  distanceKm: number;
  matchedDepartment: string | null;
  reason: string;
  rank: number;
}

interface CandidateRow {
  _id: Types.ObjectId;
  name: string;
  location: { coordinates: [number, number] };
  departments: Array<{ name: string; facultyExpertise: string[]; embedding: number[]; activeProjectCount: number }>;
  score?: unknown;
}

/**
 * Reason-generation prompt — copied verbatim from AI_ENGINE.md §4.
 * If you change a word here, change it there in the same commit.
 */
function buildReasonPrompt(
  description: string,
  category: string,
  institutionName: string,
  departmentLine: string,
  distanceKm: number,
): string {
  return `You are explaining why a university was matched to a citizen-reported civic problem.
Problem: "${INJECTION_GUARD}${description}"
Category: ${category}
Matched institution: ${institutionName}
Relevant department: ${departmentLine}
Distance: ${Math.round(distanceKm)} km

Write ONE short sentence (max 25 words) explaining the match in plain, specific language.
Mention the specific department/expertise and the distance if it's under 100km.
If no department profile is available, explain the match using the institution's type,
location and proximity instead — do not invent a department or a research area.
Do not use generic phrases like "good fit" or "strong match" — cite the specific reason.

Respond with only the sentence, no other text.`;
}

async function generateReason(prompt: string): Promise<string | null> {
  // Groq first for latency, Gemini as fallback — same order as classification.
  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("GROQ_API_KEY")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        /**
         * gpt-oss is a REASONING model: it spends tokens thinking before it
         * answers, and that thinking counts against max_tokens. A budget of 80
         * — generous for a 25-word sentence — was consumed by reasoning and
         * truncated the actual answer mid-word ("As an engineering").
         *
         * Low effort plus a wider budget. The task is a one-sentence
         * explanation; there is nothing here worth deliberating over.
         */
        reasoning_effort: "low",
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(TIMEOUTS.generateMs),
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const text = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
        ?.message?.content;
      if (typeof text === "string" && text.trim()) return text.trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // fall through to Gemini
  }

  try {
    const response = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
      }),
      signal: AbortSignal.timeout(TIMEOUTS.generateMs),
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const text = (
        body as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }
      ).candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === "string" && text.trim()) return text.trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // both providers unavailable
  }

  return null;
}

/**
 * A factual fallback reason, used when both providers are down.
 *
 * Deliberately plain rather than persuasive: it states the department and the
 * distance and nothing else. A coordinator seeing a flat sentence is far
 * better served than one seeing no match at all, and routing must not depend
 * on an LLM being reachable.
 */
function fallbackReason(
  institutionName: string,
  departmentName: string | null,
  distanceKm: number,
): string {
  const distance = `${Math.round(distanceKm)} km away`;
  return departmentName
    ? `${institutionName}'s ${departmentName} department is the closest capability match, ${distance}.`
    : `${institutionName} is ${distance} and is the nearest institution with relevant capability on record.`;
}

/**
 * Finds the top institutions for a problem.
 *
 * Returns [] when no institution has been seeded or none is indexed yet —
 * an empty list means "not routed", which the caller must not present as a
 * successful routing.
 */
export async function matchProblem(
  embedding: readonly number[],
  problemLat: number,
  problemLng: number,
  description: string,
  category: string,
): Promise<MatchResult[]> {
  const candidates = (await Institution.aggregate([
    {
      $vectorSearch: {
        index: "institution_capability_index",
        path: "capabilityEmbedding",
        queryVector: [...embedding],
        numCandidates: 100,
        limit: CANDIDATE_POOL,
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        location: 1,
        departments: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ])) as CandidateRow[];

  if (candidates.length === 0) return [];

  const scored = candidates.map((candidate) => {
    // Atlas returns cosine rescaled into [0,1]; recover the real cosine so the
    // weights in §4 mean what they say. Same trap as dedup.
    const similarity =
      typeof candidate.score === "number" ? atlasScoreToCosine(candidate.score) : 0;

    const [lng, lat] = candidate.location.coordinates;
    const distanceKm = haversineKm(problemLat, problemLng, lat, lng);
    const distancePenalty = Math.min(distanceKm / DISTANCE_SATURATION_KM, 1);

    /**
     * Matched department — §4 step 4.
     *
     * The vector search ranks INSTITUTIONS, so nothing about it says which
     * department matched. Comparing the problem against each department's own
     * stored vector is plain arithmetic over ~5 vectors: no index, no API call.
     * Shallow institutions have no departments, so this stays null and the
     * reason prompt is told not to invent one.
     */
    let matchedDepartment: string | null = null;
    let matchedExpertise: string[] = [];
    let activeProjectCount = 0;
    let bestDepartmentSimilarity = -Infinity;
    let fallbackDepartment: string | null = null;
    let fallbackSimilarity = -Infinity;

    for (const department of candidate.departments) {
      if (department.embedding.length !== embedding.length) continue;
      const departmentSimilarity = cosineSimilarity(embedding, department.embedding);

      /**
       * Only departments with real expertise text can RAISE a score.
       *
       * A bare department name is a label, not a capability. Worse, short
       * generic strings sit near everything in embedding space: measured on
       * this data, a name-only "Mathematics" scored 0.6202 against a
       * contaminated-water problem while NIT Raipur's Civil Engineering — which
       * actually lists "Water Resources Development and Irrigation
       * Engineering" — scored 0.5802. Letting bare names compete promotes
       * institutions we know least about over the ones we know most about,
       * which is exactly backwards.
       *
       * Name-only departments are still eligible to be NAMED as the matched
       * department when nothing better exists, so the reason line can say
       * something true; they simply cannot inflate the ranking.
       */
      if (department.facultyExpertise.length > 0) {
        if (departmentSimilarity > bestDepartmentSimilarity) {
          bestDepartmentSimilarity = departmentSimilarity;
          matchedDepartment = department.name;
          matchedExpertise = department.facultyExpertise;
          activeProjectCount = department.activeProjectCount;
        }
      } else if (departmentSimilarity > fallbackSimilarity) {
        fallbackSimilarity = departmentSimilarity;
        fallbackDepartment = department.name;
      }
    }

    // No department has expertise on record — name the closest one anyway, but
    // score on the institution vector alone.
    if (matchedDepartment === null && fallbackDepartment !== null) {
      matchedDepartment = fallbackDepartment;
      matchedExpertise = [];
    }

    /**
     * Score on the BEST of the institution vector and its best department,
     * rather than the institution vector alone as §4 originally said.
     *
     * Averaging every department into one vector punishes exactly the
     * institutions this platform wants to find. NIT Raipur lists fifteen
     * departments; its institution vector is dominated by the three with
     * written-up research areas (all computing), so a water-supply problem
     * scored it #58 of 163 — below scores of polytechnics whose profile is
     * nothing but "<name> — technical institute in <district>". Its Civil
     * Engineering department vector is a far better answer to that problem
     * than its institution average, and max-pooling is what surfaces it.
     *
     * Capability lives in departments; the institution vector is a summary.
     * When the summary and the specific disagree, trust the specific.
     */
    const capabilitySimilarity = Math.max(
      similarity,
      bestDepartmentSimilarity === -Infinity ? similarity : bestDepartmentSimilarity,
    );

    const loadPenalty = Math.min(
      LOAD_PENALTY_PER_PROJECT * activeProjectCount,
      LOAD_PENALTY_CAP,
    );

    const finalScore =
      SIMILARITY_WEIGHT * capabilitySimilarity - DISTANCE_WEIGHT * distancePenalty - loadPenalty;

    return {
      candidate,
      finalScore,
      distanceKm,
      matchedDepartment,
      matchedExpertise,
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  const top = scored.slice(0, RESULT_COUNT);

  // Reasons in parallel — three independent calls should not run serially in
  // the citizen's submit path.
  const reasons = await Promise.all(
    top.map(async (entry) => {
      const departmentLine =
        entry.matchedDepartment !== null
          ? `${entry.matchedDepartment}: ${entry.matchedExpertise.join(", ")}`
          : "none on record — AISHE/AICTE listing only";

      const prompt = buildReasonPrompt(
        description,
        category,
        entry.candidate.name,
        departmentLine,
        entry.distanceKm,
      );
      return (
        (await generateReason(prompt)) ??
        fallbackReason(entry.candidate.name, entry.matchedDepartment, entry.distanceKm)
      );
    }),
  );

  return top.map((entry, index) => ({
    institutionId: entry.candidate._id.toString(),
    institutionName: entry.candidate.name,
    score: Number(entry.finalScore.toFixed(4)),
    distanceKm: Number(entry.distanceKm.toFixed(1)),
    matchedDepartment: entry.matchedDepartment,
    reason: reasons[index] ?? "",
    rank: index + 1,
  }));
}
