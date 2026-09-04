import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { VISIBLE_PROBLEM_FILTER } from "@/lib/constants";
import { requireRole, AuthError } from "@/lib/auth";
import { CATEGORY_ENUM } from "@/lib/constants";

/**
 * GET /api/admin/heatmap — auth: admin.
 *
 * Returns one point per problem: [{ lat, lng, weight, locationSource }].
 * `locationSource` is included so the UI can distinguish GPS-verified from
 * manually-placed points, per DESIGN.md §8 — an admin reviewing data quality
 * should be able to tell them apart without opening every record.
 */

/**
 * Vercel kills a function at its maxDuration and replaces the response with a
 * generic platform error. The default is 10s, and this route legitimately
 * needs longer: connect (up to 5s) + embed (10s) + dedup + classify (15s, and
 * again on the Gemini fallback) + matching with three reason calls. A typical
 * submission finishes in 4-5s, but one slow provider on demo day would be cut
 * off mid-flight — losing the careful degradation in AI_ENGINE.md §7, which
 * exists precisely so a citizen never loses a report.
 */
export const maxDuration = 60;

const QuerySchema = z.object({
  category: z.enum(CATEGORY_ENUM).optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
});

// Above this, returning one point per problem is wasteful and the browser
// cannot draw them meaningfully anyway.
const AGGREGATE_ABOVE = 5000;

export async function GET(request: Request) {
  try {
    await requireRole("admin");
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters.", code: "VALIDATION_FAILED" },
      { status: 400 },
    );
  }
  const q = parsed.data;

  await connectToDatabase();

  const filter: Record<string, unknown> = {
    status: { $ne: "duplicate_merged" as const },
    ...VISIBLE_PROBLEM_FILTER,
  };
  if (q.category) filter.category = q.category;
  if (q.dateFrom || q.dateTo) {
    const range: Record<string, Date> = {};
    if (q.dateFrom) range.$gte = new Date(q.dateFrom);
    if (q.dateTo) range.$lte = new Date(q.dateTo);
    filter.createdAt = range;
  }

  const total = await Problem.countDocuments(filter);

  if (total > AGGREGATE_ABOVE) {
    // Pre-aggregate by district, as API_SPEC.md allows. locationSource is
    // deliberately null here: a district bucket mixes both kinds, and picking
    // one would misreport data quality.
    const rows = await Problem.aggregate<{
      _id: string;
      count: number;
      lat: number;
      lng: number;
    }>([
      { $match: filter },
      {
        $group: {
          _id: "$district",
          count: { $sum: 1 },
          lat: { $avg: { $arrayElemAt: ["$location.coordinates", 1] } },
          lng: { $avg: { $arrayElemAt: ["$location.coordinates", 0] } },
        },
      },
    ]);
    return NextResponse.json({
      aggregated: true,
      total,
      points: rows.map((r) => ({
        lat: r.lat,
        lng: r.lng,
        weight: r.count,
        locationSource: null,
        district: r._id,
      })),
    });
  }

  const problems = await Problem.find(filter)
    .select("location locationSource upvoteCount district state category")
    .lean();

  return NextResponse.json({
    aggregated: false,
    total,
    points: problems.map((p) => ({
      // ⚠ Mongo stores [lng, lat]. Unpacked explicitly here because a heatmap
      // with swapped coordinates renders happily in the wrong hemisphere.
      lat: p.location.coordinates[1],
      lng: p.location.coordinates[0],
      // More people reporting the same thing means a hotter point.
      weight: p.upvoteCount + 1,
      locationSource: p.locationSource,
      district: p.district,
      state: p.state,
      category: p.category,
    })),
  });
}
