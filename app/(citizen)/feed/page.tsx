import Link from "next/link";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { UpvoteButton } from "@/components/citizen/UpvoteButton";
import { CATEGORY_ENUM } from "@/lib/constants";

/**
 * Public problem feed. A server component reading the database directly —
 * there is no benefit to a client round trip through our own API for a
 * read-only list, and it keeps the page fast on a slow connection.
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

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

async function loadProblems(filter: Record<string, unknown>) {
  await connectToDatabase();
  return Problem.find(filter)
    .select("-embedding")
    .sort({ upvoteCount: -1, createdAt: -1 })
    .limit(50)
    .lean();
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;

  const activeCategory =
    category && (CATEGORY_ENUM as readonly string[]).includes(category) ? category : null;

  // Merged reports are deliberately excluded: they are supporting evidence for
  // another problem, not separate problems, and listing both would make the
  // deduplication look like it had not worked.
  const filter: Record<string, unknown> = { status: { $ne: "duplicate_merged" } };
  if (activeCategory) filter.category = activeCategory;

  /**
   * A database outage must degrade, not 500.
   *
   * Without this the page throws and Next serves a bare error — verified: an
   * unreachable Atlas gave HTTP 500 and an empty screen. PRD §11 lists
   * demo-day connectivity as a top risk, and a blank error page in front of
   * judges is exactly the failure that risk describes. An honest "cannot load
   * right now" keeps the page, the navigation, and the submit path intact.
   */
  let problems: Awaited<ReturnType<typeof loadProblems>> = [];
  let loadFailed = false;
  try {
    problems = await loadProblems(filter);
  } catch (error: unknown) {
    console.error("[feed] could not load problems:", error instanceof Error ? error.message : error);
    loadFailed = true;
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <p className="text-sm font-medium tracking-wide text-accent uppercase">JanSetu</p>
        <h1 className="font-display mt-2 text-2xl text-ink-900">What people are reporting</h1>
        <p className="mt-3 text-base text-ink-600">
          Problems reported by citizens, most supported first. Add your support
          to one that affects you too.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-touch items-center rounded-button bg-accent px-5 text-base font-medium text-white transition-colors hover:bg-[#a84a1a]"
        >
          Report a problem
        </Link>
      </header>

      <nav aria-label="Filter by category" className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/feed"
          className={`rounded-button border px-3 py-2 text-sm transition-colors ${
            activeCategory === null
              ? "border-accent bg-accent-subtle text-accent"
              : "border-border bg-surface text-ink-600 hover:bg-accent-subtle"
          }`}
        >
          All
        </Link>
        {CATEGORY_ENUM.map((c) => (
          <Link
            key={c}
            href={`/feed?category=${c}`}
            className={`rounded-button border px-3 py-2 text-sm transition-colors ${
              activeCategory === c
                ? "border-accent bg-accent-subtle text-accent"
                : "border-border bg-surface text-ink-600 hover:bg-accent-subtle"
            }`}
          >
            {CATEGORY_LABELS[c]}
          </Link>
        ))}
      </nav>

      {loadFailed ? (
        <div className="mt-8 rounded-card border border-border bg-surface p-6">
          <p className="text-base text-ink-900">Reports could not be loaded right now.</p>
          <p className="mt-2 text-sm text-ink-600">
            This is a connection problem on our side, not something you did.
            You can still report a problem — submissions are saved separately.
          </p>
          <Link
            href="/feed"
            className="mt-4 inline-flex min-h-touch items-center rounded-button border border-border bg-surface px-5 text-base font-medium text-ink-900 transition-colors hover:bg-accent-subtle"
          >
            Try again
          </Link>
        </div>
      ) : problems.length === 0 ? (
        // DESIGN.md §5 — one specific sentence and one clear action. No
        // illustration, and no pretending there is data.
        <div className="mt-8 rounded-card border border-border bg-surface p-6">
          <p className="text-base text-ink-900">
            {activeCategory
              ? `No ${CATEGORY_LABELS[activeCategory]?.toLowerCase()} problems have been reported yet.`
              : "No problems have been reported yet."}
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex min-h-touch items-center rounded-button border border-border bg-surface px-5 text-base font-medium text-ink-900 transition-colors hover:bg-accent-subtle"
          >
            Be the first to report one
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {problems.map((p) => (
            <li
              key={p._id.toString()}
              className="flex gap-4 rounded-card border border-border bg-surface p-4"
            >
              <UpvoteButton problemId={p._id.toString()} initialCount={p.upvoteCount} />
              <div className="min-w-0">
                <p className="text-base text-ink-900">{p.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-ink-600">{p.description}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-300">
                  <span>
                    {p.district}, {p.state}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{timeAgo(p.createdAt)}</span>
                  {p.category && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-ink-600">
                        {CATEGORY_LABELS[p.category] ?? p.category}
                      </span>
                    </>
                  )}
                  {p.needsReview && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-warning">awaiting review</span>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
