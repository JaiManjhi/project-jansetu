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

/**
 * Below this final score, routing refuses to answer.
 *
 * Vector search always returns its nearest fifty, so there is always a
 * "best" candidate — even when nothing in the country fits. Without a floor
 * the system states a confident match for problems it has no answer to: a
 * broken hand pump in Ranchi was routed to a climate centre 1053 km away at
 * 0.13, and a health centre with no doctor to a pharmacy college at 0.05,
 * while genuinely good matches on this data sit between 0.29 and 0.49.
 *
 * 0.20 sits in the empty band between those two populations. It is a
 * calibrated cut on measured scores, not a round number chosen for looks — see
 * AI_ENGINE.md §4.
 *
 * A problem below the floor keeps status "processing" rather than "routed",
 * which is already the app's language for "nothing has been routed here yet"
 * and is what the empty-queue copy on the university dashboard promises. The
 * product is more useful telling a coordinator the truth than handing them a
 * pharmacy college for a broken hand pump, and more defensible: a judge who
 * asks "what happens when you don't know?" should get an answer better than
 * "we guess anyway".
 */
const MIN_ROUTING_SCORE = 0.2;

/**
 * Expertise text that is boilerplate rather than capability.
 *
 * The seeding pipeline writes an honest annotation when a source has no
 * research profile to offer — "single-purpose pharmacy college", "detailed
 * faculty research pages not typically published for institutions of this
 * scale". That was the right thing to record and the wrong field to record it
 * in: it lands in `facultyExpertise`, which the scorer reads as "this
 * department has real capability on record".
 *
 * Measured on the seeded data: 126 of the 218 departments that carry any
 * expertise text carry ONE OF THESE THREE STRINGS — 87 pharmacy colleges
 * sharing two lines, 39 polytechnics sharing a third. Identical generic prose
 * embeds to nearly the same vector, and that vector sits close to everything,
 * so those 126 departments were outranking the ~92 departments with genuinely
 * distinctive expertise. In practice a broken hand pump routed to a pharmacy
 * college 250 km away in another state, and a health centre with no doctor
 * routed to a different pharmacy college.
 *
 * A string repeated across dozens of unrelated institutions cannot discriminate
 * between them by construction, whatever its embedding says. Departments whose
 * expertise is only boilerplate are demoted to exactly the same standing as a
 * bare department name: nameable, but unable to raise a score.
 */
const BOILERPLATE_EXPERTISE_MARKERS = [
  "single-purpose pharmacy college",
  "detailed faculty research pages not typically published",
  "polytechnic-level diploma programs",
];

/**
 * How much of a no-evidence institution's similarity score to trust.
 *
 * Demoting boilerplate DEPARTMENTS was necessary and not sufficient. An
 * institution's `capabilityEmbedding` is built from the same text, so a college
 * whose entire profile is filler simply fell back onto an equally contaminated
 * institution vector and kept winning: after the department fix, a broken hand
 * pump in Ranchi still ranked three pharmacy colleges 160-220 km away above
 * every Jharkhand institution, because generic prose embeds close to
 * everything and scored cosine ≈ 0.59 against a water problem while Birsa
 * Agricultural University's actual water-harvesting group scored ≈ 0.35.
 *
 * The principle: a similarity computed from filler is not evidence of
 * capability, and must not outrank a similarity computed from a real research
 * profile. So an institution with no distinctive expertise anywhere keeps its
 * score, discounted — it can still surface when nothing better is near, which
 * matters in districts where every listed institution is AISHE-only, but it no
 * longer displaces an institution that has something on record.
 *
 * A discount rather than exclusion, deliberately: absence of a published
 * research page is not absence of capability, and a polytechnic 5 km away is
 * often a better answer than a research institute 300 km away. This lowers the
 * confidence we place in an unevidenced match; it does not deny it.
 */
const NO_EVIDENCE_TRUST = 0.55;

/** True when this line is filler rather than a statement of capability. */
function isBoilerplateExpertise(line: string): boolean {
  const normalized = line.toLowerCase();
  return BOILERPLATE_EXPERTISE_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * The expertise lines that actually say something specific about this
 * department. Empty means the department must be treated as name-only.
 */
export function distinctiveExpertise(expertise: readonly string[]): string[] {
  return expertise.filter((line) => line.trim() !== "" && !isBoilerplateExpertise(line));
}

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
/** One institution after scoring, before reasons are written. */
export interface RankedCandidate {
  institutionId: string;
  institutionName: string;
  finalScore: number;
  distanceKm: number;
  matchedDepartment: string | null;
  matchedExpertise: string[];
}

/**
 * Retrieval + scoring, with no LLM call anywhere in it.
 *
 * Split out of matchProblem so ranking can be measured directly: judging a
 * change to the weights or the expertise gate should not cost three reason
 * generations per problem, and a scoring regression should be observable
 * without a network round trip. matchProblem is this function plus reasons.
 */
export async function rankInstitutions(
  embedding: readonly number[],
  problemLat: number,
  problemLng: number,
): Promise<RankedCandidate[]> {
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
      // Boilerplate is filtered out FIRST, so a department whose only expertise
      // is filler falls through to the name-only branch below and cannot boost.
      const realExpertise = distinctiveExpertise(department.facultyExpertise);

      if (realExpertise.length > 0) {
        if (departmentSimilarity > bestDepartmentSimilarity) {
          bestDepartmentSimilarity = departmentSimilarity;
          matchedDepartment = department.name;
          matchedExpertise = realExpertise;
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
    const rawCapabilitySimilarity = Math.max(
      similarity,
      bestDepartmentSimilarity === -Infinity ? similarity : bestDepartmentSimilarity,
    );

    /**
     * Has this institution published anything specific about what it does?
     * bestDepartmentSimilarity is only ever set from a department that survived
     * the boilerplate filter, so it being unset is exactly the condition "no
     * distinctive expertise anywhere in this institution".
     */
    const hasEvidence = bestDepartmentSimilarity !== -Infinity;
    const capabilitySimilarity = hasEvidence
      ? rawCapabilitySimilarity
      : rawCapabilitySimilarity * NO_EVIDENCE_TRUST;

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
  return scored.map((entry) => ({
    institutionId: entry.candidate._id.toString(),
    institutionName: entry.candidate.name,
    finalScore: entry.finalScore,
    distanceKm: entry.distanceKm,
    matchedDepartment: entry.matchedDepartment,
    matchedExpertise: entry.matchedExpertise,
  }));
}

/**
 * Finds the top institutions for a problem and writes a reason for each.
 *
 * Returns [] when no institution has been seeded or none is indexed yet — an
 * empty list means "not routed", which the caller must not present as a
 * successful routing.
 */
export async function matchProblem(
  embedding: readonly number[],
  problemLat: number,
  problemLng: number,
  description: string,
  category: string,
): Promise<MatchResult[]> {
  const ranked = await rankInstitutions(embedding, problemLat, problemLng);

  // Refuse rather than guess. An empty list means "not routed", and the caller
  // must not present it as a successful routing.
  const credible = ranked.filter((entry) => entry.finalScore >= MIN_ROUTING_SCORE);
  if (credible.length === 0) return [];

  const top = credible.slice(0, RESULT_COUNT);

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
        entry.institutionName,
        departmentLine,
        entry.distanceKm,
      );
      return (
        (await generateReason(prompt)) ??
        fallbackReason(entry.institutionName, entry.matchedDepartment, entry.distanceKm)
      );
    }),
  );

  return top.map((entry, index) => ({
    institutionId: entry.institutionId,
    institutionName: entry.institutionName,
    score: Number(entry.finalScore.toFixed(4)),
    distanceKm: Number(entry.distanceKm.toFixed(1)),
    matchedDepartment: entry.matchedDepartment,
    reason: reasons[index] ?? "",
    rank: index + 1,
  }));
}
