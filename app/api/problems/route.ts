import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { CreateProblemSchema, ListProblemsQuerySchema, deriveTitle } from "@/lib/validators";
import { resolveDistrict, toGeoPoint, isWithinIndia } from "@/lib/geo/district";
import { embedText, EmbeddingUnavailableError } from "@/lib/ai/embed";
import { classifyProblem, ClassificationUnavailableError } from "@/lib/ai/classify";
import { findDuplicate } from "@/lib/ai/dedup";
import { getSessionUser } from "@/lib/auth";

/**
 * POST /api/problems — public. API_SPEC.md.
 *
 * Runs the pipeline from ARCHITECTURE.md §6: validate → GeoJSON → district →
 * save → embed → dedup → classify. Matching (step 7) is not wired yet; it
 * needs institution data, so `matches` is currently always empty.
 *
 * The governing rule for this route: a submission is never lost. The doc is
 * written before any AI call, and every downstream failure degrades to
 * needsReview: true with a 201, never an error response (AI_ENGINE.md §7).
 */

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", "INVALID_JSON", 400);
  }

  const parsed = CreateProblemSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorResponse(
      first ? `${first.path.join(".")}: ${first.message}` : "Invalid request body.",
      "VALIDATION_FAILED",
      400,
    );
  }
  const input = parsed.data;
  const { lat, lng } = input.location;

  // Cheap tripwire for the swapped-pair bug: a swapped Indian coordinate lands
  // outside the country, so this catches it before anything is written.
  if (!isWithinIndia(lat, lng)) {
    return errorResponse(
      "Those coordinates are outside India. If you passed {lat, lng} in the wrong order, that is the usual cause.",
      "COORDINATES_OUT_OF_RANGE",
      400,
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return errorResponse("Could not reach the database.", "DB_UNAVAILABLE", 503);
  }

  // Derived server-side, never read from the request body.
  const { district, state } = resolveDistrict(lat, lng);
  const user = await getSessionUser();

  // Written BEFORE any AI call, so the report survives whatever happens next.
  const problem = await Problem.create({
    title: input.title ?? deriveTitle(input.description),
    description: input.description,
    language: input.language,
    category: null,
    severityScore: null,
    location: toGeoPoint(lat, lng),
    locationSource: input.locationSource,
    locationAccuracyM: input.locationSource === "gps" ? input.locationAccuracyM ?? null : null,
    district,
    state,
    mediaUrls: input.mediaUrls,
    submittedBy: user?.role === "citizen" ? user.id : null,
    status: "processing",
    needsReview: false,
  });

  let needsReview = false;

  // ---- embed ----------------------------------------------------------
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(input.description);
    problem.embedding = embedding;
    await problem.save();
  } catch (error: unknown) {
    if (!(error instanceof EmbeddingUnavailableError)) throw error;
    console.error(`[problems] embedding failed for ${problem._id.toString()}: ${error.message}`);
    needsReview = true;
  }

  // ---- dedup ----------------------------------------------------------
  // Skipped when embedding failed: with no vector there is nothing to compare,
  // and treating that as "not a duplicate" is the safe direction.
  if (embedding) {
    const dedup = await findDuplicate(embedding, district, problem._id);
    if (dedup.isDuplicate && dedup.bestMatch) {
      // One read, for the fields the response needs. API_SPEC.md specifies
      // that a duplicate_merged response carries the EXISTING problem's
      // category, not null — the citizen is being shown that problem.
      const original = await Problem.findById(dedup.bestMatch.problemId)
        .select("_id category severityScore")
        .lean();

      problem.status = "duplicate_merged";
      problem.duplicateOf = original?._id ?? null;
      problem.needsReview = false;
      await problem.save();

      await Problem.updateOne(
        { _id: dedup.bestMatch.problemId },
        {
          $inc: { upvoteCount: 1 },
          ...(input.mediaUrls.length > 0
            ? { $addToSet: { mediaUrls: { $each: input.mediaUrls } } }
            : {}),
        },
      );

      return NextResponse.json(
        {
          problemId: problem._id.toString(),
          status: "duplicate_merged",
          category: original?.category ?? null,
          severityScore: original?.severityScore ?? null,
          district,
          state,
          needsReview: false,
          duplicateOf: dedup.bestMatch.problemId,
          duplicate: {
            problemId: dedup.bestMatch.problemId,
            title: dedup.bestMatch.title,
            description: dedup.bestMatch.description,
            upvoteCount: dedup.bestMatch.upvoteCount + 1,
            similarity: Number(dedup.bestMatch.similarity.toFixed(4)),
          },
          matches: [],
        },
        { status: 201 },
      );
    }
  }

  // ---- classify -------------------------------------------------------
  try {
    const result = await classifyProblem(input.description);
    problem.category = result.category;
    problem.severityScore = result.severityScore;
    if (result.provider === "fallback-default") needsReview = true;
  } catch (error: unknown) {
    if (!(error instanceof ClassificationUnavailableError)) throw error;
    console.error(`[problems] classification failed for ${problem._id.toString()}: ${error.message}`);
    needsReview = true;
  }

  // ---- route ----------------------------------------------------------
  // TODO(Day 2 data): lib/ai/match.ts needs seeded institutions. Until then
  // there is nothing to route to, and the problem stays unrouted rather than
  // being marked "routed" with an empty match list, which would misreport it
  // on the admin dashboard.
  const matches: never[] = [];

  problem.needsReview = needsReview;
  // "routed" means routed TO something. With matching unbuilt there are no
  // matches, so claiming "routed" would tell the Day 8 admin dashboard that
  // problems reached institutions that do not exist yet. Once match.ts lands
  // and returns candidates, this becomes true on its own.
  problem.status = needsReview || matches.length === 0 ? "processing" : "routed";
  await problem.save();

  return NextResponse.json(
    {
      problemId: problem._id.toString(),
      status: problem.status,
      category: problem.category,
      severityScore: problem.severityScore,
      district,
      state,
      needsReview,
      duplicateOf: null,
      matches,
    },
    { status: 201 },
  );
}

/** GET /api/problems — public list, used by the feed and admin dashboard. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = ListProblemsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse("Invalid query parameters.", "VALIDATION_FAILED", 400);
  }
  const q = parsed.data;

  // needsReview exposes failed submissions and is admin-only (API_SPEC.md).
  if (q.needsReview !== undefined) {
    const user = await getSessionUser();
    if (user?.role !== "admin") {
      return errorResponse("The needsReview filter requires an admin session.", "FORBIDDEN", 403);
    }
  }

  try {
    await connectToDatabase();
  } catch {
    return errorResponse("Could not reach the database.", "DB_UNAVAILABLE", 503);
  }

  const filter: Record<string, unknown> = {};
  if (q.category) filter.category = q.category;
  if (q.state) filter.state = q.state;
  if (q.district) filter.district = q.district;
  if (q.status) filter.status = q.status;
  if (q.needsReview) filter.needsReview = q.needsReview === "true";

  const [items, total] = await Promise.all([
    Problem.find(filter)
      .select("-embedding") // never ship 768 floats to a list view
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Problem.countDocuments(filter),
  ]);

  return NextResponse.json({ items, total, page: q.page, limit: q.limit });
}
