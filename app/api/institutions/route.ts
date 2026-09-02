import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { Institution } from "@/models/Institution";

/** GET /api/institutions — public list. API_SPEC.md. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filter: Record<string, unknown> = {};
  for (const key of ["state", "type", "dataDepth"] as const) {
    const value = url.searchParams.get(key);
    if (value) filter[key] = value;
  }

  await connectToDatabase();
  const items = await Institution.find(filter)
    // Vectors are large and of no use to a caller listing institutions.
    .select("-capabilityEmbedding -departments.embedding")
    .sort({ name: 1 })
    .limit(500)
    .lean();

  return NextResponse.json({ items, total: items.length });
}
