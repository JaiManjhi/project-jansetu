import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { Pledge } from "@/models/Pledge";
import { Project } from "@/models/Project";
import { requireRole, AuthError } from "@/lib/auth";
import { PLEDGE_TYPE_ENUM } from "@/lib/constants";

/**
 * Pledges — API_SPEC.md.
 *
 * PRD §3 is explicit that these are RECORDED, not processed. No payment rail
 * is involved and none is implied anywhere in the UI copy.
 */

const CreateSchema = z
  .object({
    projectId: z.string(),
    type: z.enum(PLEDGE_TYPE_ENUM),
    note: z.string().max(2000).default(""),
    amount: z.number().min(0).max(1_000_000_000).nullable().default(null),
  })
  .refine((v) => v.type === "funding" || v.amount === null, {
    message: "amount may only be set when type is 'funding'",
    path: ["amount"],
  });

export async function POST(request: Request) {
  let user;
  try {
    user = await requireRole("industry");
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Invalid pledge.", code: "VALIDATION_FAILED" },
      { status: 400 },
    );
  }
  if (!isValidObjectId(parsed.data.projectId)) {
    return NextResponse.json({ error: "projectId must be a valid id.", code: "VALIDATION_FAILED" }, { status: 400 });
  }

  await connectToDatabase();
  const project = await Project.findById(parsed.data.projectId).select("_id").lean();
  if (!project) {
    return NextResponse.json({ error: "Project not found.", code: "NOT_FOUND" }, { status: 404 });
  }

  const pledge = await Pledge.create({
    projectId: parsed.data.projectId,
    partnerId: user.id,
    type: parsed.data.type,
    note: parsed.data.note,
    amount: parsed.data.amount,
  });

  return NextResponse.json({ pledgeId: pledge._id.toString(), ...parsed.data }, { status: 201 });
}

/** GET /api/pledges?projectId= — public, shown on the project page. */
export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId || !isValidObjectId(projectId)) {
    return NextResponse.json({ error: "projectId is required.", code: "VALIDATION_FAILED" }, { status: 400 });
  }

  await connectToDatabase();
  // partnerId is deliberately not projected: who pledged is not public.
  const pledges = await Pledge.find({ projectId })
    .select("type note amount createdAt")
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({ items: pledges });
}
