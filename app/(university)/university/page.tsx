import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { Match } from "@/models/Match";
import { Problem } from "@/models/Problem";
import { Project } from "@/models/Project";
import { Institution } from "@/models/Institution";
import { QueueList, type QueueEntry } from "@/components/university/QueueList";
import { ProjectCard } from "@/components/university/ProjectCard";
import { VISIBLE_PROBLEM_FILTER } from "@/lib/constants";

/**
 * University coordinator dashboard — PRD §5 "functional but simple".
 *
 * Two sections and nothing more: problems routed here waiting to be claimed,
 * and the projects this institution has taken on. No approval workflow, no
 * document versioning — both are explicitly out of scope.
 */

export const dynamic = "force-dynamic";

export default async function UniversityDashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login?callbackUrl=/university");
  if (user.role !== "university") redirect("/");
  if (!user.institutionId) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <h1 className="font-display text-2xl text-ink-900">No institution linked</h1>
        <p className="mt-3 max-w-prose text-base text-ink-600">
          This account is not linked to an institution, so there is no queue to
          show. An administrator needs to set its institution before it can
          claim problems.
        </p>
      </main>
    );
  }

  await connectToDatabase();
  const institutionId = user.institutionId;

  const [institution, matches, projects] = await Promise.all([
    Institution.findById(institutionId).select("name district state departments").lean(),
    Match.find({ institutionId }).sort({ score: -1 }).limit(50).lean(),
    Project.find({ institutionId }).sort({ claimedAt: -1 }).limit(50).lean(),
  ]);

  // Only unclaimed problems belong in the queue.
  const problemIds = matches.map((m) => m.problemId);
  const problems = problemIds.length
    ? await Problem.find({
        _id: { $in: problemIds },
        status: { $in: ["routed", "processing"] },
        ...VISIBLE_PROBLEM_FILTER,
      })
        .select("-embedding")
        .lean()
    : [];
  const problemById = new Map(problems.map((p) => [p._id.toString(), p]));

  const entries: QueueEntry[] = matches
    .map((m) => {
      const problem = problemById.get(m.problemId.toString());
      if (!problem) return null;
      return {
        problem: {
          _id: problem._id.toString(),
          title: problem.title,
          description: problem.description,
          district: problem.district,
          state: problem.state,
          category: problem.category,
          severityScore: problem.severityScore,
          upvoteCount: problem.upvoteCount,
        },
        match: {
          score: m.score,
          distanceKm: m.distanceKm,
          matchedDepartment: m.matchedDepartment,
          reason: m.reason,
        },
      };
    })
    .filter((e): e is QueueEntry => e !== null);

  const claimedProblems = projects.length
    ? await Problem.find({ _id: { $in: projects.map((p) => p.problemId) }, ...VISIBLE_PROBLEM_FILTER })
        .select("title")
        .lean()
    : [];
  const titleById = new Map(claimedProblems.map((p) => [p._id.toString(), p.title]));

  const activeLoad = (institution?.departments ?? []).reduce(
    (sum, d) => sum + d.activeProjectCount,
    0,
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <header>
        <p className="text-sm font-medium tracking-wide text-accent uppercase">
          JanSetu · University
        </p>
        <h1 className="font-display mt-2 text-2xl text-ink-900">
          {institution?.name ?? "Your institution"}
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          {institution ? `${institution.district}, ${institution.state} · ` : ""}
          {institution?.departments.length ?? 0} departments · {activeLoad} active{" "}
          {activeLoad === 1 ? "project" : "projects"}
        </p>
      </header>

      <section className="mt-10">
        <h2 className="font-display text-xl text-ink-900">Routed to you</h2>
        <p className="mt-1 text-sm text-ink-600">
          Problems matched to your departments. Claiming one removes it from
          other institutions&apos; queues.
        </p>
        <QueueList entries={entries} institutionId={institutionId} />
      </section>

      <section className="mt-12">
        <h2 className="font-display text-xl text-ink-900">Your projects</h2>
        {projects.length === 0 ? (
          <div className="mt-6 rounded-card border border-border bg-surface p-6">
            <p className="text-base text-ink-900">You have not claimed anything yet.</p>
            <p className="mt-2 text-sm text-ink-600">
              Claimed problems appear here, where you can record progress.
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-4">
            {projects.map((project) => (
              <ProjectCard
                key={project._id.toString()}
                problemTitle={titleById.get(project.problemId.toString()) ?? "Untitled problem"}
                project={{
                  _id: project._id.toString(),
                  status: project.status,
                  statusNote: project.statusNote,
                  teamMembers: project.teamMembers,
                  matchedDepartment: project.matchedDepartment,
                  claimedAt: project.claimedAt.toISOString(),
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
