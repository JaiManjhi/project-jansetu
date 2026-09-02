import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/media/sign — API_SPEC.md.
 *
 * Issues a short-lived Cloudinary upload signature. The secret stays on the
 * server; the browser uploads straight to Cloudinary so a multi-megabyte phone
 * photo never passes through a Vercel function.
 */

export const CLOUDINARY_FOLDER = "jansetu/problems";

// An unauthenticated signing endpoint is an open door to someone else's
// storage quota if it is not bounded.
const LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const limit = rateLimit(`sign:${clientIp(request)}`, LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads from this device. Try again later.", code: "RATE_LIMITED" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    // Photos are optional; the submission path must keep working without them.
    return NextResponse.json(
      { error: "Photo upload is not configured on this server.", code: "MEDIA_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Cloudinary's scheme: the signed params sorted by key, joined as a query
  // string, with the secret appended, then SHA-1. Only the params included
  // here are authorised — a client cannot smuggle in an extra one.
  const toSign = `folder=${CLOUDINARY_FOLDER}&timestamp=${timestamp}`;
  const signature = createHash("sha1").update(toSign + apiSecret).digest("hex");

  return NextResponse.json({ cloudName, apiKey, timestamp, folder: CLOUDINARY_FOLDER, signature });
}
