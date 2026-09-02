import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { Project } from "@/models/Project";
import { Problem } from "@/models/Problem";
import { Institution } from "@/models/Institution";
import { getSessionUser } from "@/lib/auth";

/**
 * GET /api/projects — API_SPEC.md.
 *
 * Scope depends on role: a university sees its own, industry sees everything
 * claimed (that is the point — they are looking for work to back), an admin
 * sees all. Anyone unauthenticated sees nothing.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to continue.", code: "UNAUTHENTICATED" }, { status: 401 });
  }

  await connectToDatabase();

  const url = new URL(request.url);
  const filter: Record<string, unknown> = {};
  if (user.role === "university") filter.institutionId = user.institutionId;
  const status = url.searchParams.get("status");
  if (status) filter.status = status;

  const projects = await Project.find(filter).sort({ claimedAt: -1 }).limit(100).lean();
  if (projects.length === 0) return NextResponse.json({ items: [] });

  // Two lookups rather than N — a project list is useless without the problem
  // it is solving and the institution solving it.
  const [problems, institutions] = await Promise.all([
    Problem.find({ _id: { $in: projects.map((p) => p.problemId) } }).select("-embedding").lean(),
    Institution.find({ _id: { $in: projects.map((p) => p.institutionId) } })
      .select("name district state")
      .lean(),
  ]);
  const problemById = new Map(problems.map((p) => [p._id.toString(), p]));
  const institutionById = new Map(institutions.map((i) => [i._id.toString(), i]));

  return NextResponse.json({
    items: projects.map((project) => ({
      project,
      problem: problemById.get(project.problemId.toString()) ?? null,
      institution: institutionById.get(project.institutionId.toString()) ?? null,
    })),
  });
}
