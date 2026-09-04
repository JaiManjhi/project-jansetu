import type { Types } from "mongoose";
import { Problem } from "../../models/Problem.ts";
import { cosineSimilarity } from "./embed.ts";

/**
 * Deduplication — AI_ENGINE.md §3.
 *
 * Runs after embedding and BEFORE classification: dedup never consults the
 * category, so a duplicate costs zero LLM generation calls and returns fast.
 */

/**
 * Raw-cosine threshold — CALIBRATED, not a placeholder.
 *
 * Swept 0.60-0.95 in 0.01 steps against the 50-pair labelled set (AI_ENGINE.md
 * §6). F1 peaks at exactly 0.82 (P 0.955, R 0.955). The classes do overlap, so
 * no value is perfect: true duplicates span 0.7912-0.9319, distinct pairs
 * 0.6338-0.8550.
 *
 * Re-run `npm run eval -- dedup` after any change to the embedding model or
 * dimension. This number is only valid for the vectors it was measured on.
 */
export const DEDUP_THRESHOLD = 0.82;

/** Dedup only looks back this far, per §3. */
export const DEDUP_WINDOW_DAYS = 90;

/**
 * How far back the freshness sweep looks. Atlas Search indexing is
 * ASYNCHRONOUS — a document is durable in MongoDB immediately but does not
 * become searchable by $vectorSearch for seconds to tens of seconds.
 *
 * Measured: a duplicate submitted immediately after its original was NOT
 * detected; the same submission 20 seconds later WAS. That window is precisely
 * when a live demo runs — submit the original, then submit the duplicate — so
 * relying on $vectorSearch alone means the best demo beat silently fails.
 *
 * Ten minutes comfortably covers observed lag without pulling a large set.
 */
export const RECENCY_WINDOW_MS = 10 * 60 * 1000;

/** Cap on documents pulled by the freshness sweep, to bound its cost. */
const RECENCY_MAX_DOCS = 50;

/**
 * Atlas returns cosine rescaled into [0,1]; this recovers the real cosine.
 *
 *     atlasScore = (1 + rawCosine) / 2
 *
 * Verified against directly-computed cosine to four decimal places. Comparing
 * the Atlas score against 0.82 directly would be a raw-cosine threshold of
 * 0.64 and would merge plainly unrelated reports — silently, because a wrong
 * merge looks exactly like a successful dedup.
 */
export function atlasScoreToCosine(atlasScore: number): number {
  return 2 * atlasScore - 1;
}

export interface DedupCandidate {
  problemId: string;
  title: string;
  description: string;
  upvoteCount: number;
  /** True cosine similarity, already converted from the Atlas score. */
  similarity: number;
}

export interface DedupResult {
  isDuplicate: boolean;
  /** The best candidate considered, duplicate or not. null if nothing matched
   *  the filters at all (e.g. the first report ever in that district). */
  bestMatch: DedupCandidate | null;
  threshold: number;
}

interface RawHit {
  _id: Types.ObjectId;
  title?: unknown;
  description?: unknown;
  upvoteCount?: unknown;
  /** null or absent when visible; a Date once an admin has removed it. */
  removedAt?: unknown;
  score?: unknown;
}

/**
 * Finds whether a freshly-embedded problem duplicates an existing one.
 *
 * `selfId` is the new problem's own _id. The doc is written before this runs,
 * so without excluding it the search returns the submission itself at
 * similarity 1.0 — a false positive on every submission.
 */
export async function findDuplicate(
  embedding: readonly number[],
  district: string,
  selfId: Types.ObjectId,
): Promise<DedupResult> {
  const windowStart = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const hits = (await Problem.aggregate([
    {
      $vectorSearch: {
        index: "problem_embedding_index",
        path: "embedding",
        // Copied because the driver's pipeline type wants a mutable array.
        queryVector: [...embedding],
        numCandidates: 100,
        // One extra slot: this submission itself is indexable and will occupy
        // a result at similarity 1.0 before being filtered out by _id below.
        limit: 6,
        // Every path here MUST be declared as a `filter` field on the index
        // (DATA_MODEL.md). Atlas rejects an undeclared filter at QUERY time,
        // not at index creation, so a missing one looks fine until now.
        filter: {
          district: { $eq: district },
          // Only merged docs are excluded. Deliberately NOT filtering out
          // "processing": a problem sits in that state whenever the pipeline
          // has not fully completed — including every problem right now, since
          // matching is unbuilt — and excluding it would leave dedup with no
          // candidates at all. Self-match is prevented by the _id filter
          // below, which does not depend on status at all.
          status: { $ne: "duplicate_merged" },
          createdAt: { $gte: windowStart },
        },
      },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        upvoteCount: 1,
        removedAt: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ])) as RawHit[];

  /**
   * Removed reports are excluded HERE rather than in the $vectorSearch filter
   * above, deliberately. Every path in that filter must be declared as a
   * `filter` field on the Atlas index, and `removedAt` is not — adding it there
   * would make Atlas reject every dedup query at runtime, which is exactly the
   * trap the comment on that block warns about. Filtering in memory costs
   * nothing at this size and needs no index change.
   *
   * It matters because a removed report must not absorb later submissions: if
   * an abusive post were left as a dedup candidate, a genuine report of the
   * same problem would be merged into it and silently disappear.
   */
  const candidates: DedupCandidate[] = hits
    .filter((h) => !h._id.equals(selfId) && typeof h.score === "number" && !h.removedAt)
    .map((h) => ({
      problemId: h._id.toString(),
      title: typeof h.title === "string" ? h.title : "",
      description: typeof h.description === "string" ? h.description : "",
      upvoteCount: typeof h.upvoteCount === "number" ? h.upvoteCount : 0,
      similarity: atlasScoreToCosine(h.score as number),
    }));

  // Freshness sweep — covers the Atlas indexing lag described above. Reads
  // through the ordinary { district, createdAt } index, which is immediately
  // consistent, and compares in memory. Without this, two reports of the same
  // problem submitted moments apart are never recognised as duplicates.
  const recent = await Problem.find({
    district,
    createdAt: { $gte: new Date(Date.now() - RECENCY_WINDOW_MS) },
    status: { $ne: "duplicate_merged" },
    removedAt: null,
    _id: { $ne: selfId },
    embedding: { $exists: true },
  })
    .select("title description upvoteCount embedding")
    .sort({ createdAt: -1 })
    .limit(RECENCY_MAX_DOCS)
    .lean();

  for (const doc of recent) {
    if (!doc.embedding) continue;
    candidates.push({
      problemId: doc._id.toString(),
      title: doc.title,
      description: doc.description,
      upvoteCount: doc.upvoteCount,
      similarity: cosineSimilarity(embedding, doc.embedding),
    });
  }

  // The same document can arrive from both sources; keep its best score.
  const byId = new Map<string, DedupCandidate>();
  for (const c of candidates) {
    const seen = byId.get(c.problemId);
    if (!seen || c.similarity > seen.similarity) byId.set(c.problemId, c);
  }

  const bestMatch = [...byId.values()].sort((a, b) => b.similarity - a.similarity)[0];
  if (!bestMatch) {
    return { isDuplicate: false, bestMatch: null, threshold: DEDUP_THRESHOLD };
  }

  const similarity = bestMatch.similarity;

  const isDuplicate = similarity >= DEDUP_THRESHOLD;

  // §3 requires logging every decision. Calibration is done, but this stays:
  // it is the only visibility into a merge that should not have happened, and
  // a wrong merge is otherwise indistinguishable from a correct one.
  console.info(
    `[dedup] district=${district} similarity=${similarity.toFixed(4)} ` +
      `threshold=${DEDUP_THRESHOLD} decision=${isDuplicate ? "DUPLICATE" : "distinct"} ` +
      `against=${bestMatch.problemId}`,
  );

  return { isDuplicate, bestMatch, threshold: DEDUP_THRESHOLD };
}
