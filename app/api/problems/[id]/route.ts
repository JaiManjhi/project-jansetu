import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { Project } from "@/models/Project";
import { requireRole, AuthError } from "@/lib/auth";
import { PROBLEM_STATUS_ENUM, VISIBLE_PROBLEM_FILTER } from "@/lib/constants";
import { z } from "zod";

/** GET /api/problems/:id — public. PATCH — auth: university or admin. */

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidObjectId(id)) {
    return errorResponse("Not a valid problem id.", "INVALID_ID", 400);
  }

  await connectToDatabase();
  const problem = await Problem.findOne({ _id: id, ...VISIBLE_PROBLEM_FILTER })
    .select("-embedding")
    .lean();
  // A removed report is a 404 rather than a tombstone: returning "this was
  // removed for abuse" alongside the text would republish what was taken down.
  if (!problem) return errorResponse("Problem not found.", "NOT_FOUND", 404);

  // If this report was merged into another, return the one it was merged into
  // as well — a citizen following their own submission needs to land on the
  // live problem, not a dead end (PRD §6: "know what happened to it").
  const mergedInto = problem.duplicateOf
    ? await Problem.findOne({ _id: problem.duplicateOf, ...VISIBLE_PROBLEM_FILTER })
        .select("-embedding")
        .lean()
    : null;

  return NextResponse.json({ problem, mergedInto });
}

const PatchSchema = z.object({ status: z.enum(PROBLEM_STATUS_ENUM) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidObjectId(id)) {
    return errorResponse("Not a valid problem id.", "INVALID_ID", 400);
  }

  let user;
  try {
    user = await requireRole("university", "admin");
  } catch (error: unknown) {
    if (error instanceof AuthError) return errorResponse(error.message, error.code, error.status);
    throw error;
  }

  /**
   * API_SPEC.md: "auth: university (must own the claim) or admin".
   *
   * The role check alone was NOT enough — any signed-in coordinator could
   * change the status of any problem in the country, including one claimed by
   * a different institution. Ownership is proven by a project on this problem
   * belonging to the caller's institution.
   */
  if (user.role === "university") {
    await connectToDatabase();
    const owned = await Project.findOne({ problemId: id, institutionId: user.institutionId })
      .select("_id")
      .lean();
    if (!owned) {
      return errorResponse(
        "You can only update problems your institution has claimed.",
        "FORBIDDEN",
        403,
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", "INVALID_JSON", 400);
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("status must be a valid problem status.", "VALIDATION_FAILED", 400);
  }

  await connectToDatabase();
  const updated = await Problem.findByIdAndUpdate(
    id,
    { status: parsed.data.status },
    { new: true },
  )
    .select("-embedding")
    .lean();

  if (!updated) return errorResponse("Problem not found.", "NOT_FOUND", 404);
  return NextResponse.json({ problem: updated });
}
