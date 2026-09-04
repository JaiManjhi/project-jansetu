import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { translateProblem, TranslationUnavailableError } from "@/lib/ai/translate";
import { TRANSLATION_LANGUAGE_ENUM } from "@/lib/constants";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/problems/:id/translate — public. API_SPEC.md.
 *
 * Returns the report in the requested language, translating it the first time
 * anyone asks and caching the result on the problem so every reader after that
 * costs nothing. Nothing is translated at submission time: translating every
 * report into every language would multiply the AI spend on every submission
 * for readers who may never arrive.
 */

export const maxDuration = 30;

/**
 * Public and it spends provider quota, so it is rate-limited like the other two
 * public AI routes. Higher than submission's 20/hour because reading is a
 * higher-volume activity than reporting — someone browsing the feed may
 * legitimately translate a dozen reports in a sitting — and because a cache hit
 * costs nothing, so the limit only really binds on genuinely new translations.
 */
const TRANSLATE_LIMIT = 60;
const TRANSLATE_WINDOW_MS = 60 * 60 * 1000;

const BodySchema = z.object({
  targetLanguage: z.enum(TRANSLATION_LANGUAGE_ENUM),
});

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidObjectId(id)) {
    return errorResponse("Not a valid problem id.", "INVALID_ID", 400);
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
      "targetLanguage must be one of the supported reading languages.",
      "VALIDATION_FAILED",
      400,
    );
  }
  const target = parsed.data.targetLanguage;

  try {
    await connectToDatabase();
  } catch {
    return errorResponse("Could not reach the database.", "DB_UNAVAILABLE", 503);
  }

  const problem = await Problem.findById(id)
    .select("title description language translations")
    .lean();
  if (!problem) return errorResponse("Problem not found.", "NOT_FOUND", 404);

  // Already in that language — return the original rather than paying to
  // "translate" Bengali into Bengali.
  if (problem.language === target) {
    return NextResponse.json({
      targetLanguage: target,
      title: problem.title,
      description: problem.description,
      source: "original",
    });
  }

  const cached = problem.translations?.[target];
  if (cached) {
    return NextResponse.json({
      targetLanguage: target,
      title: cached.title,
      description: cached.description,
      source: "cached",
    });
  }

  // Rate limit is checked only past the cache, so re-reading translations
  // someone already paid for never counts against a reader's budget.
  const limit = rateLimit(`translate:${clientIp(request)}`, TRANSLATE_LIMIT, TRANSLATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Too many translation requests from this device. Please try again later.",
        code: "RATE_LIMITED",
      },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let result;
  try {
    result = await translateProblem(problem.title, problem.description, target);
  } catch (error: unknown) {
    if (!(error instanceof TranslationUnavailableError)) throw error;
    console.error(`[translate] failed for ${id} → ${target}: ${error.message}`);
    return errorResponse(
      "Translation is unavailable right now. Please try again shortly.",
      "TRANSLATION_UNAVAILABLE",
      503,
    );
  }

  /**
   * Written with a targeted $set rather than by saving the whole document: two
   * readers asking for two different languages at the same moment would
   * otherwise each write back a full `translations` object built from the state
   * they read, and the slower write would drop the other's translation.
   */
  await Problem.updateOne(
    { _id: id },
    {
      $set: {
        [`translations.${target}`]: {
          title: result.title,
          description: result.description,
          translatedAt: new Date(),
        },
      },
    },
  );

  return NextResponse.json({
    targetLanguage: target,
    title: result.title,
    description: result.description,
    source: "translated",
  });
}
