import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { Project } from "@/models/Project";
import { Problem } from "@/models/Problem";
import { Institution } from "@/models/Institution";
import { requireRole, AuthError } from "@/lib/auth";
import { PROJECT_STATUS_ENUM } from "@/lib/constants";

/** PATCH /api/projects/:id — auth: university, own project only. API_SPEC.md. */

const PatchSchema = z.object({
  status: z.enum(PROJECT_STATUS_ENUM).optional(),
  statusNote: z.string().max(2000).optional(),
  teamMembers: z.array(z.string().max(120)).max(20).optional(),
});

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidObjectId(id)) return errorResponse("Not a valid project id.", "INVALID_ID", 400);

  await connectToDatabase();
  const project = await Project.findById(id).lean();
  if (!project) return errorResponse("Project not found.", "NOT_FOUND", 404);

  const [problem, institution] = await Promise.all([
    Problem.findById(project.problemId).select("-embedding").lean(),
    Institution.findById(project.institutionId).select("name district state").lean(),
  ]);

  return NextResponse.json({ project, problem, institution });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidObjectId(id)) return errorResponse("Not a valid project id.", "INVALID_ID", 400);

  let user;
  try {
    user = await requireRole("university", "admin");
  } catch (error: unknown) {
    if (error instanceof AuthError) return errorResponse(error.message, error.code, error.status);
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", "INVALID_JSON", 400);
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid update.", "VALIDATION_FAILED", 400);
  }

  await connectToDatabase();
  const project = await Project.findById(id);
  if (!project) return errorResponse("Project not found.", "NOT_FOUND", 404);

  if (user.role === "university" && project.institutionId.toString() !== user.institutionId) {
    return errorResponse("You can only update your own institution's projects.", "FORBIDDEN", 403);
  }

  const previousStatus = project.status;
  const nextStatus = parsed.data.status ?? previousStatus;

  if (parsed.data.status) project.status = parsed.data.status;
  if (parsed.data.statusNote !== undefined) project.statusNote = parsed.data.statusNote;
  if (parsed.data.teamMembers) project.teamMembers = parsed.data.teamMembers;
  await project.save();

  /**
   * Release the load-balance slot on completion — the only place the counter
   * goes down.
   *
   * Guarded on an actual TRANSITION, not on the target value. Without that, a
   * coordinator saving the form twice on an already-completed project
   * decrements twice, and the count drifts negative until the routing penalty
   * starts quietly rewarding the busiest departments — the exact opposite of
   * what it is for.
   */
  if (
    previousStatus !== "completed" &&
    nextStatus === "completed" &&
    project.matchedDepartment
  ) {
    await Institution.updateOne(
      {
        _id: project.institutionId,
        "departments.name": project.matchedDepartment,
        "departments.activeProjectCount": { $gt: 0 },
      },
      { $inc: { "departments.$.activeProjectCount": -1 } },
    );
  }

  // Keep the problem's own status in step, so the citizen-facing view and the
  // admin dashboard do not disagree with the project.
  const problemStatus =
    nextStatus === "completed" ? "resolved" : nextStatus === "in_progress" ? "in_progress" : "claimed";
  await Problem.updateOne({ _id: project.problemId }, { status: problemStatus });

  return NextResponse.json({ project: project.toObject() });
}
