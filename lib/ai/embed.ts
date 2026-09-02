import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  GEMINI_BASE,
  TIMEOUTS,
  geminiKeys,
} from "./models.ts";

/**
 * Embedding generation — AI_ENGINE.md §2.
 *
 * Used for two things that must stay compatible: problems.embedding and
 * institutions.capabilityEmbedding / departments[].embedding. They are
 * compared directly against each other, so both go through this one function
 * at one dimension. Never embed with a different model or size.
 */

export class EmbeddingUnavailableError extends Error {
  constructor(cause: string) {
    super(`embedding unavailable: ${cause}`);
    this.name = "EmbeddingUnavailableError";
  }
}

interface GeminiEmbedResponse {
  embedding?: { values?: unknown };
}

function parseVector(raw: unknown): number[] {
  if (typeof raw !== "object" || raw === null) {
    throw new EmbeddingUnavailableError("response was not an object");
  }
  const values = (raw as GeminiEmbedResponse).embedding?.values;
  if (!Array.isArray(values)) {
    throw new EmbeddingUnavailableError("response had no embedding.values array");
  }
  if (values.length !== EMBEDDING_DIMENSIONS) {
    // A dimension mismatch is not a degraded result — it is a hard query error
    // against an Atlas index built for 768. Fail here, loudly, rather than
    // writing a vector that can never be searched.
    throw new EmbeddingUnavailableError(
      `expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values.length}`,
    );
  }
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new EmbeddingUnavailableError(`non-finite value at index ${i}`);
    }
    out[i] = v;
  }
  return out;
}

/**
 * Embeds one piece of text. Throws EmbeddingUnavailableError on any failure —
 * callers decide what that means. For POST /api/problems it means saving the
 * submission with needsReview: true rather than losing it (AI_ENGINE.md §7).
 */
export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new EmbeddingUnavailableError("empty text");

  /**
   * Try each configured key in turn, moving on only when one is rate limited.
   *
   * Keys from separate Google projects have separate daily quotas, and that
   * quota is the binding constraint here — a single seeding run drains one
   * key. Any other error (a bad key, a malformed request) fails immediately
   * rather than being retried against every key, because trying a second key
   * cannot fix a request that was itself wrong.
   */
  const keys = geminiKeys();
  let lastRateLimitBody = "";

  for (const apiKey of keys) {
    let response: Response;
    try {
      response = await fetch(`${GEMINI_BASE}/${EMBEDDING_MODEL}:embedContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: trimmed }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(TIMEOUTS.embedMs),
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new EmbeddingUnavailableError(`network/timeout — ${reason}`);
    }

    if (response.ok) return parseVector(await response.json());

    const body = await response.text().catch(() => "");
    if (response.status === 429) {
      lastRateLimitBody = body.slice(0, 200);
      continue; // this key is spent for today; try the next
    }
    throw new EmbeddingUnavailableError(`HTTP ${response.status} ${body.slice(0, 200)}`);
  }

  throw new EmbeddingUnavailableError(
    `HTTP 429 — all ${keys.length} Gemini key(s) rate limited. ${lastRateLimitBody}`,
  );
}

/**
 * Embeds many texts with bounded concurrency. Used by the institution seed
 * script, which embeds one vector per institution plus one per department.
 *
 * Sequential would be needlessly slow over hundreds of institutions, and
 * unbounded Promise.all would trip the free-tier rate limit and fail the whole
 * batch. Five at a time is the compromise.
 */
export async function embedTexts(
  texts: readonly string[],
  concurrency = 5,
): Promise<number[][]> {
  const results = new Array<number[]>(texts.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= texts.length) return;
      const text = texts[index];
      if (text === undefined) continue;
      results[index] = await embedText(text);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, texts.length) }, worker),
  );
  return results;
}

/**
 * Cosine similarity between two vectors from this module.
 *
 * ⚠ Not interchangeable with Atlas's $meta:"vectorSearchScore", which returns
 * (1 + cosine) / 2. AI_ENGINE.md §3 has the conversion and why confusing the
 * two silently merges unrelated reports.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
