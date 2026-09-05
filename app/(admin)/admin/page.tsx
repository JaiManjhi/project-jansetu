import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { Institution } from "@/models/Institution";
import { Project } from "@/models/Project";
import { CATEGORY_ENUM, VISIBLE_PROBLEM_FILTER } from "@/lib/constants";
import { Heatmap, type HeatPoint } from "@/components/admin/Heatmap";

/**
 * Government admin dashboard — DESIGN.md §8.
 *
 * Desktop-first and information-dense is explicitly allowed here; this is the
 * "serious government tool" screen. It still respects the spacing and type
 * scales, and it still refuses to invent data it does not have.
 *
 * Reads the database directly rather than calling our own admin API. The route
 * handlers exist for testing and for any external consumer (API_SPEC.md), but
 * a server component fetching its own HTTP endpoint just adds a round trip and
 * a second place for the auth check to be wrong.
 */

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  water_resources: "Water",
  healthcare: "Healthcare",
  education: "Education",
  agriculture: "Agriculture",
  environment: "Environment",
  energy: "Energy",
  urban_infrastructure: "Infrastructure",
  accessibility: "Accessibility",
  public_administration: "Administration",
  rural_livelihoods: "Livelihoods",
};

/**
 * Removed reports are excluded from every figure on this dashboard as well as
 * from the heatmap. A report taken down for abuse is not a civic problem that
 * was reported, and counting it would overstate demand in that district.
 * The removed COUNT is surfaced separately below, so moderation stays visible.
 */
const NOT_MERGED = { ...{ status: { $ne: "duplicate_merged" as const } }, ...VISIBLE_PROBLEM_FILTER };

async function loadDashboard() {
  await connectToDatabase();

  const [total, byCategoryRaw, byStateRaw, needsReview, mergedCount, removedCount, points, institutions, projects] =
    await Promise.all([
      Problem.countDocuments(NOT_MERGED),
      Problem.aggregate<{ _id: string | null; count: number }>([
        { $match: NOT_MERGED },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]),
      Problem.aggregate<{ _id: string; count: number }>([
        { $match: NOT_MERGED },
        { $group: { _id: "$state", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Problem.countDocuments({ needsReview: true, ...VISIBLE_PROBLEM_FILTER }),
      Problem.countDocuments({ status: "duplicate_merged", ...VISIBLE_PROBLEM_FILTER }),
      Problem.countDocuments({ removedAt: { $ne: null } }),
      Problem.find(NOT_MERGED).select("location locationSource upvoteCount district state").limit(5000).lean(),
      Institution.countDocuments(),
      Project.aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

  return { total, byCategoryRaw, byStateRaw, needsReview, mergedCount, removedCount, points, institutions, projects };
}

export default async function AdminDashboard() {
  // Server-side role check. ARCHITECTURE.md §8 — hiding a link is not access
  // control, and this page reads the whole dataset.
  const user = await getSessionUser();
  if (!user) redirect("/login?callbackUrl=/admin");
  if (user.role !== "admin") redirect("/");

  let data: Awaited<ReturnType<typeof loadDashboard>> | null = null;
  try {
    data = await loadDashboard();
  } catch (error: unknown) {
    console.error("[admin] load failed:", error instanceof Error ? error.message : error);
  }

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <h1 className="font-display text-2xl text-ink-900">Dashboard unavailable</h1>
        <p className="mt-3 max-w-prose text-base text-ink-600">
          The database could not be reached. Nothing has been lost — citizen
          submissions are stored independently and will appear here once the
          connection is restored.
        </p>
      </main>
    );
  }

  const byCategory = new Map(CATEGORY_ENUM.map((c) => [c as string, 0]));
  let unclassified = 0;
  for (const row of data.byCategoryRaw) {
    if (row._id === null) unclassified += row.count;
    else byCategory.set(row._id, row.count);
  }
  const categoryRows = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const maxCategory = Math.max(1, ...categoryRows.map(([, n]) => n));

  const heatPoints: HeatPoint[] = data.points.map((p) => ({
    lat: p.location.coordinates[1],
    lng: p.location.coordinates[0],
    weight: p.upvoteCount + 1,
    locationSource: p.locationSource,
    district: p.district,
    state: p.state,
  }));

  const gpsCount = heatPoints.filter((p) => p.locationSource === "gps").length;
  const projectsByStatus = new Map(data.projects.map((p) => [p._id, p.count]));
  const claimed = (projectsByStatus.get("claimed") ?? 0) + (projectsByStatus.get("in_progress") ?? 0);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-wide text-accent uppercase">JanSetu · Administration</p>
          <h1 className="font-display mt-2 text-2xl text-ink-900">National overview</h1>
        </div>
        <p className="text-sm text-ink-300">Signed in as {user.role}</p>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Problems reported" value={data.total} />
        <Stat label="States covered" value={data.byStateRaw.length} />
        <Stat
          label="Merged as duplicates"
          value={data.mergedCount}
          hint={data.total > 0 ? `${Math.round((data.mergedCount / (data.total + data.mergedCount)) * 100)}% of submissions` : undefined}
        />
        <Stat
          label="Awaiting review"
          value={data.needsReview}
          tone={data.needsReview > 0 ? "warning" : undefined}
          hint={data.needsReview > 0 ? "Classification failed" : undefined}
        />
      </section>

      {/* Only shown once something has been removed — a permanent zero would be
          a tile earning its place on the dashboard by doing nothing. */}
      {data.removedCount > 0 && (
        <section className="mt-4">
          <p className="border-l-2 border-warning bg-surface px-4 py-3 text-sm text-ink-600">
            <span className="font-medium text-warning">
              {data.removedCount} report{data.removedCount === 1 ? "" : "s"} removed
            </span>{" "}
            from the public feed. Removed reports are excluded from every figure above. They are
            listed in place on the{" "}
            <Link href="/feed" className="text-accent underline underline-offset-2">
              feed
            </Link>{" "}
            where you can review the reason or restore them.
          </p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-display text-xl text-ink-900">Where problems are being reported</h2>
        <p className="mt-1 text-sm text-ink-600">
          {data.total === 0
            ? "No problems reported yet — the map will fill in as citizens submit."
            : `${data.total} problems across ${data.byStateRaw.length} states and union territories. ${gpsCount} of ${heatPoints.length} have a GPS-verified location.`}
        </p>
        <div className="mt-4">
          <Heatmap points={heatPoints} />
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="font-display text-xl text-ink-900">By category</h2>
          {data.total === 0 ? (
            <p className="mt-3 text-sm text-ink-600">Nothing to break down yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {categoryRows.map(([category, count]) => (
                <li key={category} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-sm text-ink-600">
                    {CATEGORY_LABELS[category] ?? category}
                  </span>
                  {/* A plain bar, not a chart library. One dependency saved and
                      it reads correctly at any width. */}
                  <span className="h-6 flex-1 overflow-hidden rounded-button bg-accent-subtle">
                    <span
                      className="block h-full bg-accent"
                      style={{ width: `${(count / maxCategory) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-sm tabular-nums text-ink-900">
                    {count}
                  </span>
                </li>
              ))}
              {unclassified > 0 && (
                <li className="flex items-center gap-3 pt-2 text-sm text-warning">
                  <span className="w-32 shrink-0">Unclassified</span>
                  <span className="flex-1">AI unavailable at submission time</span>
                  <span className="w-8 text-right tabular-nums">{unclassified}</span>
                </li>
              )}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-display text-xl text-ink-900">By state</h2>
          {data.byStateRaw.length === 0 ? (
            <p className="mt-3 text-sm text-ink-600">Nothing to break down yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.byStateRaw.slice(0, 10).map((row) => (
                <li key={row._id} className="flex items-baseline justify-between border-b border-border pb-2 text-sm">
                  <span className="text-ink-900">{row._id}</span>
                  <span className="tabular-nums text-ink-600">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-xl text-ink-900">Institutions</h2>
        {data.institutions === 0 ? (
          // States the gap rather than rendering an empty table that looks broken.
          <div className="mt-4 rounded-card border border-border bg-surface p-6">
            <p className="text-base text-ink-900">No institutions have been loaded yet.</p>
            <p className="mt-2 max-w-prose text-sm text-ink-600">
              Routing stays inactive until institution data is seeded, so
              problems are classified and deduplicated but not yet matched to
              anyone. This table will rank institutions by claimed problems.
            </p>
          </div>
        ) : (
          // Three tiles in a three-column grid, not four. At lg:grid-cols-4 the
          // last cell was always empty, so the row stretched over dead space.
          <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Stat label="Institutions loaded" value={data.institutions} />
            <Stat label="Projects claimed" value={claimed} />
            <Stat label="Projects completed" value={projectsByStatus.get("completed") ?? 0} />
          </dl>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "warning";
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd
        className={`font-display mt-1 text-2xl tabular-nums ${tone === "warning" ? "text-warning" : "text-ink-900"}`}
      >
        {value}
      </dd>
      {hint && <p className="mt-1 text-xs text-ink-300">{hint}</p>}
    </div>
  );
}
