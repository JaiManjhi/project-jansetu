/**
 * Evaluation harness — AI_ENGINE.md §6.
 *
 *   npm run eval            both suites
 *   npm run eval -- class   classification only
 *   npm run eval -- dedup   dedup only
 *
 * Reports real numbers rather than claimed ones: classification accuracy plus
 * a confusion matrix, and for dedup a full threshold sweep that picks the
 * best F1 — which is how the 0.82 placeholder in §3 gets replaced with an
 * evidence-based value.
 *
 * Writes eval/results.json so the numbers are reproducible, not just printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { classifyProblem } from "../lib/ai/classify.ts";
import { embedText, cosineSimilarity } from "../lib/ai/embed.ts";
import { CATEGORY_ENUM, type Category } from "../lib/constants.ts";
import { DEDUP_THRESHOLD } from "../lib/ai/dedup.ts";

interface ClassificationItem {
  id: string;
  expected: Category;
  description: string;
}

interface DedupPair {
  id: string;
  expected: "duplicate" | "distinct";
  a: string;
  b: string;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Bounded-concurrency map — the free tiers do not like 150 parallel calls. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) continue;
      out[i] = await fn(item, i);
      if ((i + 1) % 25 === 0) process.stdout.write(`  ...${i + 1}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Retries a rate-limited call with exponential backoff.
 *
 * 150 classifications back to back will exhaust a free-tier quota — a first
 * run at concurrency 4 got HTTP 429 on 108 of 150 items and produced a
 * meaningless 26.7% "accuracy". This belongs in the harness, not in
 * classify.ts: on the live submit path the right response to a Groq 429 is to
 * fail over to Gemini immediately, because a citizen is waiting. Only a batch
 * job should sit and wait for a quota window to reopen.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let delayMs = 4000;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (i >= attempts - 1 || !message.includes("429")) throw error;
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 60_000);
    }
  }
}

async function runClassification() {
  const items = loadJson<ClassificationItem[]>("eval/classification-set.json");
  console.log(`\n=== Classification — ${items.length} labelled items ===`);
  console.log("(throttled to respect free-tier quota; this takes a few minutes)");

  const results = await mapLimit(items, 2, async (item) => {
    try {
      const r = await withRateLimitRetry(() => classifyProblem(item.description));
      return { id: item.id, expected: item.expected, actual: r.category, provider: r.provider };
    } catch (error: unknown) {
      return {
        id: item.id,
        expected: item.expected,
        actual: null,
        provider: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const correct = results.filter((r) => r.actual === r.expected).length;
  const errors = results.filter((r) => r.actual === null).length;
  const accuracy = correct / results.length;

  console.log(`\naccuracy: ${(accuracy * 100).toFixed(1)}%  (${correct}/${results.length})`);
  if (errors) console.log(`errors:   ${errors}`);

  // Per-category recall, and the confusion matrix §6 asks for. Which
  // categories get confused with which is the genuinely interesting artifact.
  console.log("\nper-category:");
  const confusion = new Map<string, Map<string, number>>();
  for (const c of CATEGORY_ENUM) confusion.set(c, new Map());
  for (const r of results) {
    if (!r.actual) continue;
    const row = confusion.get(r.expected);
    if (row) row.set(r.actual, (row.get(r.actual) ?? 0) + 1);
  }
  for (const c of CATEGORY_ENUM) {
    const row = confusion.get(c);
    if (!row) continue;
    const total = [...row.values()].reduce((a, b) => a + b, 0);
    const hit = row.get(c) ?? 0;
    const confusedWith = [...row.entries()]
      .filter(([k]) => k !== c)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}×${n}`)
      .join(", ");
    console.log(
      `  ${c.padEnd(23)} ${hit}/${total}` + (confusedWith ? `   → ${confusedWith}` : ""),
    );
  }

  const misses = results.filter((r) => r.actual && r.actual !== r.expected);
  if (misses.length) {
    console.log("\nmisclassified:");
    for (const m of misses) console.log(`  ${m.id}: expected ${m.expected}, got ${m.actual}`);
  }

  return { total: results.length, correct, errors, accuracy, results };
}

async function runDedup() {
  const pairs = loadJson<DedupPair[]>("eval/dedup-pairs.json");
  console.log(`\n=== Deduplication — ${pairs.length} labelled pairs ===`);

  const scored = await mapLimit(pairs, 4, async (p) => {
    const [va, vb] = await Promise.all([embedText(p.a), embedText(p.b)]);
    return { id: p.id, expected: p.expected, similarity: cosineSimilarity(va, vb) };
  });

  const dups = scored.filter((s) => s.expected === "duplicate").map((s) => s.similarity);
  const dist = scored.filter((s) => s.expected === "distinct").map((s) => s.similarity);
  const stat = (xs: number[]) => ({
    min: Math.min(...xs),
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    max: Math.max(...xs),
  });
  const ds = stat(dups);
  const ns = stat(dist);
  console.log(`\nraw cosine, true duplicates (n=${dups.length}): min ${ds.min.toFixed(4)}  mean ${ds.mean.toFixed(4)}  max ${ds.max.toFixed(4)}`);
  console.log(`raw cosine, distinct pairs  (n=${dist.length}): min ${ns.min.toFixed(4)}  mean ${ns.mean.toFixed(4)}  max ${ns.max.toFixed(4)}`);
  console.log(`separation: lowest duplicate ${ds.min.toFixed(4)} vs highest distinct ${ns.max.toFixed(4)}` +
    (ds.min > ns.max ? "  → cleanly separable" : "  → OVERLAPPING, no threshold is perfect"));

  function evaluateAt(t: number) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const s of scored) {
      const predicted = s.similarity >= t;
      const actual = s.expected === "duplicate";
      if (predicted && actual) tp++;
      else if (predicted && !actual) fp++;
      else if (!predicted && actual) fn++;
      else tn++;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { threshold: t, tp, fp, fn, tn, precision, recall, f1 };
  }

  console.log("\nthreshold sweep:");
  console.log("  thresh   P      R      F1     TP FP FN TN");
  const sweep: ReturnType<typeof evaluateAt>[] = [];
  for (let t = 0.60; t <= 0.95001; t += 0.01) {
    const r = evaluateAt(Number(t.toFixed(2)));
    sweep.push(r);
    const mark = Math.abs(r.threshold - DEDUP_THRESHOLD) < 0.005 ? "  ← current" : "";
    console.log(
      `  ${r.threshold.toFixed(2)}    ${r.precision.toFixed(3)}  ${r.recall.toFixed(3)}  ${r.f1.toFixed(3)}  ` +
        `${String(r.tp).padStart(2)} ${String(r.fp).padStart(2)} ${String(r.fn).padStart(2)} ${String(r.tn).padStart(2)}${mark}`,
    );
  }

  const bestF1 = Math.max(...sweep.map((s) => s.f1));
  const best = sweep.filter((s) => s.f1 === bestF1);
  // Among ties prefer the highest threshold: a false merge destroys a
  // citizen's report, a missed merge only leaves a duplicate in the feed.
  const chosen = best[best.length - 1];
  const current = evaluateAt(DEDUP_THRESHOLD);

  console.log(`\ncurrent threshold ${DEDUP_THRESHOLD}: P ${current.precision.toFixed(3)} R ${current.recall.toFixed(3)} F1 ${current.f1.toFixed(3)}`);
  if (chosen) {
    console.log(`best F1 ${chosen.f1.toFixed(3)} at threshold ${chosen.threshold.toFixed(2)}` +
      (best.length > 1 ? ` (tied across ${best.length} values ${best[0]?.threshold.toFixed(2)}–${chosen.threshold.toFixed(2)}; took the highest, since a false merge is worse than a missed one)` : ""));
  }

  const worstMisses = scored
    .filter((s) => (s.expected === "duplicate") !== (s.similarity >= (chosen?.threshold ?? DEDUP_THRESHOLD)))
    .sort((a, b) => a.similarity - b.similarity);
  if (worstMisses.length) {
    console.log("\nstill wrong at the chosen threshold:");
    for (const m of worstMisses) console.log(`  ${m.id} (${m.expected}) cosine ${m.similarity.toFixed(4)}`);
  }

  return { pairs: scored.length, scored, current, chosen, sweep };
}

const arg = process.argv[2];

// Merge into any existing results rather than overwriting: running one suite
// alone must not silently discard the other suite's recorded numbers.
let out: Record<string, unknown> = {};
try {
  out = JSON.parse(readFileSync("eval/results.json", "utf8")) as Record<string, unknown>;
} catch {
  out = {};
}
out.generatedAt = new Date().toISOString();
if (arg !== "dedup") out.classification = await runClassification();
if (arg !== "class") out.dedup = await runDedup();
writeFileSync("eval/results.json", JSON.stringify(out, null, 2) + "\n");
console.log("\nwrote eval/results.json");
