import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { Project } from "@/models/Project";
import { Problem } from "@/models/Problem";
import { Institution } from "@/models/Institution";
import { Pledge } from "@/models/Pledge";
import { PledgeForm } from "@/components/industry/PledgeForm";

/**
 * Industry partner dashboard — PRD §5 "functional but simple".
 *
 * Browse claimed projects, offer support. Pledges are recorded, never
 * processed (§3), and the UI says so rather than implying otherwise.
 */

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  claimed: "Claimed",
  in_progress: "In progress",
  completed: "Completed",
};

const PLEDGE_LABELS: Record<string, string> = {
  mentorship: "Mentorship",
  funding: "Funding",
  prototyping: "Prototyping",
};

export default async function IndustryDashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login?callbackUrl=/industry");
  if (user.role !== "industry") redirect("/");

  await connectToDatabase();

  const projects = await Project.find({}).sort({ claimedAt: -1 }).limit(50).lean();

  const [problems, institutions, pledges] = await Promise.all([
    projects.length
      ? Problem.find({ _id: { $in: projects.map((p) => p.problemId) } }).select("-embedding").lean()
      : [],
    projects.length
      ? Institution.find({ _id: { $in: projects.map((p) => p.institutionId) } })
          .select("name district state")
          .lean()
      : [],
    projects.length
      ? Pledge.find({ projectId: { $in: projects.map((p) => p._id) } })
          .select("projectId type amount")
          .lean()
      : [],
  ]);

  const problemById = new Map(problems.map((p) => [p._id.toString(), p]));
  const institutionById = new Map(institutions.map((i) => [i._id.toString(), i]));
  const pledgesByProject = new Map<string, typeof pledges>();
  for (const pledge of pledges) {
    const key = pledge.projectId.toString();
    pledgesByProject.set(key, [...(pledgesByProject.get(key) ?? []), pledge]);
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <header>
        <p className="text-sm font-medium tracking-wide text-accent uppercase">
          JanSetu · Industry
        </p>
        <h1 className="font-display mt-2 text-2xl text-ink-900">Projects seeking support</h1>
        <p className="mt-3 max-w-prose text-base text-ink-600">
          Real problems reported by citizens, claimed by universities that have
          the expertise to work on them. Offer mentorship, funding or
          prototyping support.
        </p>
        <p className="mt-2 max-w-prose text-sm text-warning">
          Pledges here are recorded as intentions. No money is taken or
          transferred through this platform.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="mt-8 rounded-card border border-border bg-surface p-6">
          <p className="text-base text-ink-900">No projects have been claimed yet.</p>
          <p className="mt-2 max-w-prose text-sm text-ink-600">
            A project appears here once a university claims a reported problem.
            Nothing is hidden — this list is empty because nothing has been
            claimed, not because of a filter.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {projects.map((project) => {
            const problem = problemById.get(project.problemId.toString());
            const institution = institutionById.get(project.institutionId.toString());
            const projectPledges = pledgesByProject.get(project._id.toString()) ?? [];

            return (
              <li key={project._id.toString()} className="rounded-card border border-border bg-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-base font-medium text-ink-900">
                    {problem?.title ?? "Untitled problem"}
                  </h2>
                  <span className="text-sm text-ink-300">
                    {STATUS_LABELS[project.status] ?? project.status}
                  </span>
                </div>

                {problem && <p className="mt-2 text-sm text-ink-600">{problem.description}</p>}

                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-300">
                  {institution && <span className="text-ink-600">{institution.name}</span>}
                  {problem && (
                    <span>
                      {problem.district}, {problem.state}
                    </span>
                  )}
                  {project.matchedDepartment && <span>{project.matchedDepartment}</span>}
                </p>

                {project.statusNote && (
                  <p className="mt-3 rounded-button border border-border bg-paper p-3 text-sm text-ink-600">
                    <span className="text-ink-300">Latest update: </span>
                    {project.statusNote}
                  </p>
                )}

                {projectPledges.length > 0 && (
                  <p className="mt-3 text-sm text-success">
                    {projectPledges.length} pledge{projectPledges.length === 1 ? "" : "s"} so far
                    {" — "}
                    {[...new Set(projectPledges.map((p) => PLEDGE_LABELS[p.type] ?? p.type))].join(", ")}
                  </p>
                )}

                <PledgeForm projectId={project._id.toString()} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
