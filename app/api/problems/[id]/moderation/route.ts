import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { requireRole, AuthError } from "@/lib/auth";
import { REMOVAL_REASON_ENUM } from "@/lib/constants";

/**
 * PATCH /api/problems/:id/moderation — auth: admin only. API_SPEC.md.
 *
 * Takes a report down, or puts it back. Submission is deliberately open to
 * anyone without an account, which is what makes JanSetu reachable — and also
 * means nothing stops someone posting abuse. This is the counterweight.
 *
 * Soft delete, always. The document is never destroyed, so a wrong call is one
 * request away from being undone, and every removal records who did it and
 * why. In a government portal a deletion nobody can account for is its own
 * problem.
 */

const BodySchema = z.discriminatedUnion("removed", [
  z.object({
    removed: z.literal(true),
    // Required on removal: a fixed list is what later makes "how much of this
    // is spam versus abuse?" a question an admin can actually answer.
    reason: z.enum(REMOVAL_REASON_ENUM),
  }),
  z.object({ removed: z.literal(false) }),
]);

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidObjectId(id)) {
    return errorResponse("Not a valid problem id.", "INVALID_ID", 400);
  }

  let user;
  try {
    // Admin only. Not university — a coordinator removing reports from their own
    // queue would be able to hide work rather than moderate content.
    user = await requireRole("admin");
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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "Send { removed: true, reason } to remove a report, or { removed: false } to restore it.",
      "VALIDATION_FAILED",
      400,
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return errorResponse("Could not reach the database.", "DB_UNAVAILABLE", 503);
  }

  /**
   * No visibility filter on this lookup, unlike every other read of a problem:
   * this is the one route that must be able to see an already-removed report,
   * because restoring one is half of what it does.
   */
  const update = parsed.data.removed
    ? { removedAt: new Date(), removedReason: parsed.data.reason, removedBy: user.id }
    : { removedAt: null, removedReason: null, removedBy: null };

  const problem = await Problem.findByIdAndUpdate(id, update, { new: true })
    .select("_id title status removedAt removedReason")
    .lean();

  if (!problem) return errorResponse("Problem not found.", "NOT_FOUND", 404);

  /**
   * `status` is deliberately untouched. Moderation and workflow are independent:
   * a removed report may already be claimed with a live project against it, and
   * overwriting the stage would destroy the record of where that work had got
   * to. Removal hides the report; it does not rewrite its history.
   */
  return NextResponse.json({
    problemId: problem._id.toString(),
    removed: problem.removedAt !== null,
    removedReason: problem.removedReason,
    status: problem.status,
  });
}
