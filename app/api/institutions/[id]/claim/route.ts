import { NextResponse } from "next/server";
import mongoose, { isValidObjectId } from "mongoose";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { Project } from "@/models/Project";
import { Match } from "@/models/Match";
import { Institution } from "@/models/Institution";
import { requireRole, AuthError } from "@/lib/auth";
import { VISIBLE_PROBLEM_FILTER } from "@/lib/constants";

/**
 * POST /api/institutions/:id/claim — auth: university. API_SPEC.md.
 *
 * Three writes, in the order the spec sets out. The third one is the easiest
 * to skip and the most consequential: `activeProjectCount` is what makes the
 * routing load-balance penalty non-zero, and skipping it leaves that penalty
 * permanently inert while everything still appears to work.
 */

const BodySchema = z.object({ problemId: z.string() });

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: institutionId } = await params;
  if (!isValidObjectId(institutionId)) {
    return errorResponse("Not a valid institution id.", "INVALID_ID", 400);
  }

  let user;
  try {
    user = await requireRole("university");
  } catch (error: unknown) {
    if (error instanceof AuthError) return errorResponse(error.message, error.code, error.status);
    throw error;
  }

  // A coordinator may only claim for their OWN institution. Without this a
  // valid university session could claim on behalf of any institution.
  if (user.institutionId !== institutionId) {
    return errorResponse(
      "You can only claim problems for your own institution.",
      "FORBIDDEN",
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", "INVALID_JSON", 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success || !isValidObjectId(parsed.data.problemId)) {
    return errorResponse("problemId must be a valid id.", "VALIDATION_FAILED", 400);
  }
  const { problemId } = parsed.data;

  await connectToDatabase();

  const problem = await Problem.findOne({ _id: problemId, ...VISIBLE_PROBLEM_FILTER })
    .select("_id status")
    .lean();
  if (!problem) return errorResponse("Problem not found.", "NOT_FOUND", 404);
  if (problem.status === "duplicate_merged") {
    return errorResponse(
      "That report was merged into another problem. Claim the one it was merged into.",
      "MERGED_PROBLEM",
      409,
    );
  }

  // Which department was matched, so the counter increments on the right one.
  const match = await Match.findOne({ problemId, institutionId })
    .select("matchedDepartment")
    .lean();
  const matchedDepartment = match?.matchedDepartment ?? null;

  // 1. Create the project FIRST. The unique index on projects.problemId is what
  //    actually prevents two institutions claiming the same problem — a
  //    read-then-write check has a window between the read and the write.
  let project;
  try {
    project = await Project.create({
      problemId,
      institutionId,
      claimedBy: user.id,
      matchedDepartment,
      teamMembers: [],
      status: "claimed",
      statusNote: "",
    });
  } catch (error: unknown) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      return errorResponse(
        "Another institution has already claimed this problem.",
        "ALREADY_CLAIMED",
        409,
      );
    }
    throw error;
  }

  // 2. Reflect the claim on the problem itself.
  await Problem.updateOne({ _id: problemId }, { status: "claimed" });

  // 3. The load-balance counter. Only meaningful with a known department.
  if (matchedDepartment) {
    await Institution.updateOne(
      { _id: institutionId, "departments.name": matchedDepartment },
      { $inc: { "departments.$.activeProjectCount": 1 } },
    );
  }

  return NextResponse.json(
    {
      projectId: project._id.toString(),
      problemId,
      institutionId,
      matchedDepartment,
      status: project.status,
    },
    { status: 201 },
  );
}
