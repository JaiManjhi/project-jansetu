import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { CreateProblemSchema, ListProblemsQuerySchema, deriveTitle } from "@/lib/validators";
import { resolveDistrict, toGeoPoint, isWithinIndia } from "@/lib/geo/district";
import { embedText, EmbeddingUnavailableError } from "@/lib/ai/embed";
import { classifyProblem, ClassificationUnavailableError } from "@/lib/ai/classify";
import { findDuplicate } from "@/lib/ai/dedup";
import { matchProblem, type MatchResult } from "@/lib/ai/match";
import { Match } from "@/models/Match";
import { getSessionUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/problems — public. API_SPEC.md.
 *
 * Runs the full pipeline from ARCHITECTURE.md §6: validate → GeoJSON →
 * district → save → embed → dedup → classify → match.
 *
 * The governing rule for this route: a submission is never lost. The doc is
 * written before any AI call, and every downstream failure degrades to
 * needsReview: true with a 201, never an error response (AI_ENGINE.md §7).
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

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Rate limit for the public submission route — ARCHITECTURE.md §8 requires it
 * and it was missing.
 *
 * This is the one unauthenticated route that spends money on every call: each
 * submission makes an embedding call, a classification call and up to three
 * reason-generation calls. Free-tier quota is the binding constraint on this
 * whole project, so an unbounded public endpoint is not just an abuse vector,
 * it is a way to lose the demo.
 *
 * 20/hour is far above what any real citizen does and well below what a script
 * can burn. ⚠ It is per IP, so a whole venue behind one NAT shares the budget —
 * worth remembering on demo day.
 */
const SUBMIT_LIMIT = 20;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const limit = rateLimit(`submit:${clientIp(request)}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Too many reports from this device. Please try again later.",
        code: "RATE_LIMITED",
      },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

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
  // Only runs with an embedding and a category — matching compares vectors and
  // the reason prompt states the category. Failure here is non-fatal: the
  // problem is still saved and simply stays unrouted.
  let matches: MatchResult[] = [];
  if (embedding && problem.category) {
    try {
      matches = await matchProblem(embedding, lat, lng, input.description, problem.category);
      if (matches.length > 0) {
        await Match.deleteMany({ problemId: problem._id });
        await Match.insertMany(
          matches.map((m) => ({
            problemId: problem._id,
            institutionId: m.institutionId,
            score: m.score,
            distanceKm: m.distanceKm,
            matchedDepartment: m.matchedDepartment,
            reason: m.reason,
            rank: m.rank,
          })),
        );
      }
    } catch (error: unknown) {
      console.error(
        `[problems] matching failed for ${problem._id.toString()}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  problem.needsReview = needsReview;
  // "routed" means routed TO something. A problem with no matches — because
  // no institution is seeded for its area, or matching failed — stays
  // "processing" rather than claiming an institution received it.
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
