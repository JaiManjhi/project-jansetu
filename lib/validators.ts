import { z } from "zod";
import { LOCATION_SOURCE_ENUM } from "./constants.ts";

/**
 * Zod schemas, shared client + server. API_SPEC.md requires server-side
 * validation on every route even where the client validates too.
 */

/**
 * POST /api/problems body.
 *
 * ⚠ `district` and `state` are deliberately absent. They are derived
 * server-side from the coordinates (DATA_MODEL.md) and must never be accepted
 * from the client — a client-supplied district that disagrees with the
 * coordinates silently splits dedup buckets. Zod strips unknown keys by
 * default, so a client that sends them is ignored rather than trusted.
 */
export const CreateProblemSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(10, "Please describe the problem in a little more detail.").max(5000),
    location: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    locationSource: z.enum(LOCATION_SOURCE_ENUM),
    locationAccuracyM: z.number().min(0).max(100_000).optional(),
    mediaUrls: z.array(z.string().url()).max(5).default([]),
    language: z.string().trim().min(2).max(12).default("en"),
  })
  .refine(
    (v) => v.locationSource === "gps" || v.locationAccuracyM === undefined,
    {
      message: "locationAccuracyM is only meaningful when locationSource is 'gps'",
      path: ["locationAccuracyM"],
    },
  );

export type CreateProblemInput = z.infer<typeof CreateProblemSchema>;

export const ListProblemsQuerySchema = z.object({
  category: z.string().optional(),
  state: z.string().optional(),
  district: z.string().optional(),
  status: z.string().optional(),
  needsReview: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Derives a short title from a description when the citizen did not supply
 * one. Deliberately not an LLM call: it would add a second generation round
 * trip to the submit path to produce something the citizen can already see.
 */
export function deriveTitle(description: string): string {
  const firstSentence = description.split(/(?<=[.!?])\s/)[0] ?? description;
  const cleaned = firstSentence.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 80) return cleaned;
  const cut = cleaned.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}
