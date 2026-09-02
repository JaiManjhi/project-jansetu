import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { Institution } from "@/models/Institution";
import { Project } from "@/models/Project";
import { requireRole, AuthError } from "@/lib/auth";
import { CATEGORY_ENUM } from "@/lib/constants";

/** GET /api/admin/stats — auth: admin. Shape per API_SPEC.md. */

export async function GET() {
  try {
    await requireRole("admin");
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  await connectToDatabase();

  // Merged duplicates are excluded from every count. They are supporting
  // evidence for another report, and counting them would inflate the totals an
  // admin uses to judge volume — the opposite of what dedup is for.
  // `as const` so the literal narrows to the status enum — a widened string
  // is rejected by the typed filter, which is the schema doing its job.
  const notMerged = { status: { $ne: "duplicate_merged" as const } };

  const [totalProblems, byCategoryRaw, byStateRaw, needsReview, projectsClaimed, projectsCompleted, institutionsActive] =
    await Promise.all([
      Problem.countDocuments(notMerged),
      Problem.aggregate<{ _id: string | null; count: number }>([
        { $match: notMerged },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]),
      Problem.aggregate<{ _id: string; count: number }>([
        { $match: notMerged },
        { $group: { _id: "$state", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Problem.countDocuments({ needsReview: true }),
      Project.countDocuments({ status: { $in: ["claimed", "in_progress"] } }),
      Project.countDocuments({ status: "completed" }),
      Project.distinct("institutionId").then((ids) => ids.length),
    ]);

  // Every category is present even at zero — a breakdown with missing keys
  // makes an empty category look like a rendering bug.
  const byCategory: Record<string, number> = Object.fromEntries(
    CATEGORY_ENUM.map((c) => [c, 0]),
  );
  let unclassified = 0;
  for (const row of byCategoryRaw) {
    if (row._id === null) unclassified += row.count;
    else if (row._id in byCategory) byCategory[row._id] = row.count;
  }

  const byState: Record<string, number> = {};
  for (const row of byStateRaw) byState[row._id] = row.count;

  const totalInstitutions = await Institution.countDocuments();

  return NextResponse.json({
    totalProblems,
    byCategory,
    byState,
    institutionsActive,
    totalInstitutions,
    projectsClaimed,
    projectsCompleted,
    // Not in the original spec shape, but the admin queue in AI_ENGINE.md §7
    // is useless without a count to drive it.
    needsReview,
    unclassified,
  });
}
