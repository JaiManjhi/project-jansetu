import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { Match } from "@/models/Match";
import { Problem } from "@/models/Problem";
import { requireRole, AuthError } from "@/lib/auth";

/**
 * GET /api/institutions/:id/queue — auth: university (own institution) or
 * admin. API_SPEC.md.
 *
 * Problems routed to this institution that nobody has claimed yet, ordered by
 * match score. Each entry carries its match reason, because PRD §6 requires a
 * coordinator to see WHY a problem reached them, not just that it did.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: institutionId } = await params;
  if (!isValidObjectId(institutionId)) {
    return NextResponse.json({ error: "Not a valid institution id.", code: "INVALID_ID" }, { status: 400 });
  }

  let user;
  try {
    user = await requireRole("university", "admin");
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  // A coordinator sees only their own queue; an admin sees any.
  if (user.role === "university" && user.institutionId !== institutionId) {
    return NextResponse.json(
      { error: "You can only view your own institution's queue.", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  await connectToDatabase();

  const matches = await Match.find({ institutionId })
    .sort({ score: -1 })
    .limit(100)
    .lean();

  if (matches.length === 0) return NextResponse.json({ items: [] });

  // Only unclaimed problems belong in a queue. PRD §6 asks that claimed ones
  // stay visible elsewhere as "claimed" rather than vanishing, but they are
  // not work this institution can pick up.
  const problems = await Problem.find({
    _id: { $in: matches.map((m) => m.problemId) },
    status: { $in: ["routed", "processing"] },
  })
    .select("-embedding")
    .lean();

  const byId = new Map(problems.map((p) => [p._id.toString(), p]));

  const items = matches
    .map((m) => {
      const problem = byId.get(m.problemId.toString());
      if (!problem) return null;
      return {
        problem,
        match: {
          score: m.score,
          distanceKm: m.distanceKm,
          matchedDepartment: m.matchedDepartment,
          reason: m.reason,
          rank: m.rank,
        },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return NextResponse.json({ items });
}
