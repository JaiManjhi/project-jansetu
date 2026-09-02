import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/problems/:id/upvote — public, rate-limited per API_SPEC.md.
 *
 * The limit is per IP AND per problem, so someone browsing the feed can
 * support many different problems quickly, but cannot inflate a single one.
 */

const LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Not a valid problem id.", code: "INVALID_ID" }, { status: 400 });
  }

  const limit = rateLimit(`upvote:${clientIp(request)}:${id}`, LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "You have already supported this report.", code: "RATE_LIMITED" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  await connectToDatabase();

  // A merged report is not its own thing any more — its supporters belong on
  // the problem it was merged into, or the count silently splits in two.
  const target = await Problem.findById(id).select("_id duplicateOf status").lean();
  if (!target) {
    return NextResponse.json({ error: "Problem not found.", code: "NOT_FOUND" }, { status: 404 });
  }
  const targetId = target.duplicateOf ?? target._id;

  const updated = await Problem.findByIdAndUpdate(
    targetId,
    { $inc: { upvoteCount: 1 } },
    { new: true },
  )
    .select("_id upvoteCount")
    .lean();

  if (!updated) {
    return NextResponse.json({ error: "Problem not found.", code: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({
    problemId: updated._id.toString(),
    upvoteCount: updated.upvoteCount,
  });
}
