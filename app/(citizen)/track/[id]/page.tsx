import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isValidObjectId } from "mongoose";
import { ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { Match } from "@/models/Match";
import { Project } from "@/models/Project";
import { Institution } from "@/models/Institution";
import { VISIBLE_PROBLEM_FILTER, type ProblemStatus } from "@/lib/constants";
import { StatusTracker } from "@/components/citizen/StatusTracker";

/**
 * Follow one report — PRD §6, "know what happened to it".
 *
 * The last missing piece of the citizen loop. Submission worked, the feed
 * worked, and the person who actually filed the report had nowhere to go to
 * find out whether anything came of it. GET /api/problems/:id has returned
 * everything this needs since Day 2; nothing ever rendered it.
 *
 * Reads the database directly rather than calling our own API over HTTP, the
 * same way the feed does — this is a server component, so a round trip through
 * our own route would add a hop and buy nothing.
 *
 * Public on purpose. The id is unguessable, the report is already public in the
 * feed, and requiring a login to follow your own report would contradict the
 * decision not to require one to file it.
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

export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ merged?: string }>;
}) {
  const [{ id }, { merged }] = await Promise.all([params, searchParams]);
  if (!isValidObjectId(id)) notFound();

  await connectToDatabase();

  const problem = await Problem.findOne({ _id: id, ...VISIBLE_PROBLEM_FILTER })
    .select("-embedding -translations")
    .lean();

  // A removed report is a 404 here for the same reason it is on the API: a
  // tombstone that quotes the text would republish what was taken down.
  if (!problem) notFound();

  /**
   * A merged report is not a dead end. The citizen who filed it should land on
   * the report their submission became supporting evidence for, because that is
   * the one that is actually moving.
   */
  if (problem.status === "duplicate_merged" && problem.duplicateOf) {
    redirect(`/track/${problem.duplicateOf.toString()}?merged=1`);
  }

  const [matches, project] = await Promise.all([
    Match.find({ problemId: problem._id }).sort({ rank: 1 }).lean(),
    Project.findOne({ problemId: problem._id }).lean(),
  ]);

  /**
   * A match stores only the institution id, so the names are resolved here in
   * one query rather than one per match. The map keeps the render loop free of
   * lookups that could silently return undefined.
   */
  const institutionIds = [
    ...matches.map((m) => m.institutionId),
    ...(project ? [project.institutionId] : []),
  ];
  const institutions = institutionIds.length
    ? await Institution.find({ _id: { $in: institutionIds } })
        .select("name district state")
        .lean()
    : [];
  const nameById = new Map(institutions.map((i) => [i._id.toString(), i.name]));

  const claimingInstitution = project
    ? (institutions.find((i) => i._id.toString() === project.institutionId.toString()) ?? null)
    : null;

  const categoryLabel = problem.category
    ? (CATEGORY_LABELS[problem.category] ?? problem.category)
    : null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/feed"
        className="inline-flex items-center gap-1.5 text-sm text-ink-600 transition-colors hover:text-accent"
      >
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        All reports
      </Link>

      {/*
        Arriving here after a redirect from a merged report. Without this the
        citizen sees someone else's wording under their own reference and has no
        idea why — the merge is the product working, so it should be stated
        rather than left to be inferred.
      */}
      {merged === "1" && (
        <div className="mt-6 border-l-2 border-accent bg-accent-subtle px-4 py-3">
          <p className="text-sm text-ink-900">
            Your report described the same problem as this one, so it was added as support for
            it. This is the report that is being worked on.
          </p>
        </div>
      )}

      <p className="mt-6 text-sm font-medium tracking-wide text-accent uppercase">
        Report status
      </p>
      <h1 className="font-display mt-2 text-2xl text-balance text-ink-900">{problem.title}</h1>

      <p className="mt-3 text-sm text-ink-600">
        {problem.district}, {problem.state}
        {problem.upvoteCount > 0 && (
          <>
            {" · "}
            {problem.upvoteCount + 1} people have reported this
          </>
        )}
      </p>

      <section className="mt-8 rounded-card border border-border bg-surface p-6">
        <h2 className="font-display text-xl text-ink-900">Progress</h2>
        <StatusTracker
          status={problem.status as ProblemStatus}
          category={problem.category}
          categoryLabel={categoryLabel}
          severityScore={problem.severityScore}
          reportedAt={problem.createdAt}
          routedCount={matches.length}
          claimedBy={claimingInstitution?.name ?? null}
          needsReview={problem.needsReview}
        />
      </section>

      {matches.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-xl text-ink-900">Who this went to</h2>
          <p className="mt-2 text-sm text-ink-600">
            Matched on what these departments actually research, not just how close they are.
          </p>
          <ol className="mt-4 grid gap-3">
            {matches.map((match) => (
              <li
                key={match._id.toString()}
                className="rounded-card border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-base font-medium text-ink-900">
                    {nameById.get(match.institutionId.toString()) ?? "Institution"}
                  </p>
                  <p className="text-sm text-ink-300 tabular-nums">
                    {match.distanceKm.toFixed(0)} km away
                  </p>
                </div>
                {match.matchedDepartment && (
                  <p className="mt-1 text-sm text-ink-600">{match.matchedDepartment}</p>
                )}
                {match.reason && (
                  <p className="mt-3 border-l-2 border-accent bg-accent-subtle px-3 py-2 text-sm text-ink-600">
                    {match.reason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {project && claimingInstitution && (
        <section className="mt-8 rounded-card border border-border bg-surface p-6">
          <h2 className="font-display text-xl text-ink-900">Who is working on it</h2>
          <p className="mt-3 text-base text-ink-900">{claimingInstitution.name}</p>
          {project.matchedDepartment && (
            <p className="mt-1 text-sm text-ink-600">{project.matchedDepartment}</p>
          )}
          {/* The coordinator's own note, when they have written one. Only the
              latest is kept — full history is not built, and saying so is
              better than implying there is more behind it. */}
          {project.statusNote ? (
            <p className="mt-4 border-l-2 border-border pl-3 text-sm text-ink-600">
              {project.statusNote}
            </p>
          ) : (
            <p className="mt-4 text-sm text-ink-300">No update posted yet.</p>
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-xl text-ink-900">What was reported</h2>
        <p className="mt-3 text-base whitespace-pre-line text-ink-600">{problem.description}</p>
      </section>

      <p className="mt-10 border-t border-border pt-6 text-sm text-ink-300">
        Keep this page&rsquo;s link to check back on this report. There are no accounts, so the
        link is the only way back to it.
      </p>
    </main>
  );
}
