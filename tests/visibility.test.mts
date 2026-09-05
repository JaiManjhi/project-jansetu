import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A source-level guard on moderation visibility.
 *
 * This bug has now shipped twice. The first time, translation and upvote were
 * missed, so a removed report was still readable in another language. The second
 * time, the university and industry pages were missed — they read the database
 * directly rather than through the API route that had been filtered, so a
 * removed report stayed in a coordinator's queue and on the industry project
 * list after an admin had taken it down.
 *
 * Both were the same mistake: a NEW read site was added, or an existing one
 * overlooked, and nothing failed. Runtime tests cannot catch this because the
 * missing filter only shows up on the one route nobody thought to check.
 *
 * So this reads the source instead. Every query against the Problem model must
 * either compose VISIBLE_PROBLEM_FILTER or appear in the allow-list below with
 * a stated reason. Adding an unlisted read site fails the build, which is the
 * only reliable moment to notice.
 */

const PROBLEM_QUERY = /Problem\.(find|findOne|findById|findByIdAndUpdate|countDocuments|aggregate)\b/;

/**
 * Reads that legitimately see removed reports. Each needs a reason, because an
 * entry added without one is how the guard quietly stops guarding.
 */
const ALLOWED: Record<string, string> = {
  "app/api/problems/[id]/moderation/route.ts":
    "the route that removes and restores — it must be able to see an already-removed report",
  "app/(admin)/admin/page.tsx":
    "admin counts removed reports separately, and NOT_MERGED already composes the filter",
  "app/api/admin/stats/route.ts":
    "same as the admin page: counts removed deliberately, other reads compose the filter",
  "app/api/admin/heatmap/route.ts": "its shared filter object composes VISIBLE_PROBLEM_FILTER",
  "app/(citizen)/feed/page.tsx":
    "composes the filter for everyone except admins, who need removed reports visible to restore them",
  "app/(citizen)/page.tsx": "landing figures compose the filter inline",
  "app/api/problems/route.ts":
    "list composes the filter; the dedup lookup is internal and reads a problem the pipeline just matched",
  "app/api/problems/[id]/route.ts": "GET composes the filter; PATCH is an authorised status write",
  "app/api/problems/[id]/upvote/route.ts": "the visibility check is on the lookup, before the write",
  "app/api/institutions/[id]/queue/route.ts": "composes the filter in its query object",
  "app/(university)/university/page.tsx": "both reads compose the filter",
  "lib/ai/dedup.ts":
    "excludes removed candidates in memory — Atlas rejects an undeclared filter field on the vector index",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

test("every read of a problem either filters removed reports or is allow-listed", () => {
  const roots = ["app", "lib"].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });

  const offenders: string[] = [];
  for (const file of roots.flatMap((r) => walk(r))) {
    const source = readFileSync(file, "utf8");
    if (!PROBLEM_QUERY.test(source)) continue;

    const key = file.replace(/\\/g, "/");
    if (key in ALLOWED) continue;
    if (source.includes("VISIBLE_PROBLEM_FILTER")) continue;

    offenders.push(key);
  }

  assert.deepEqual(
    offenders,
    [],
    `These files query Problem without composing VISIBLE_PROBLEM_FILTER.\n` +
      `Either compose it, or add the file to ALLOWED in this test with a reason:\n  ` +
      offenders.join("\n  "),
  );
});

test("every allow-list entry carries a reason", () => {
  for (const [file, reason] of Object.entries(ALLOWED)) {
    assert.ok(reason.trim().length > 20, `${file} is allow-listed without a real reason`);
  }
});
