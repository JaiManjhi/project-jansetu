/**
 * Shared enums. These mirror DATA_MODEL.md exactly.
 *
 * CATEGORY_ENUM in particular must stay identical to the category list inside
 * the classification prompt in AI_ENGINE.md §1 — the model is told to pick from
 * that list, and this is what validates the answer. If the two drift, every
 * classification silently fails validation and falls back to the safe default.
 */

export const CATEGORY_ENUM = [
  "water_resources",
  "healthcare",
  "education",
  "agriculture",
  "environment",
  "energy",
  "urban_infrastructure",
  "accessibility",
  "public_administration",
  "rural_livelihoods",
] as const;

export type Category = (typeof CATEGORY_ENUM)[number];

/** AI_ENGINE.md §1 — used when classification fails twice. */
export const FALLBACK_CATEGORY: Category = "public_administration";

export const ROLE_ENUM = [
  "citizen",
  "university",
  "industry",
  "admin",
] as const;
export type Role = (typeof ROLE_ENUM)[number];

export const PROBLEM_STATUS_ENUM = [
  "processing",
  "routed",
  "claimed",
  "in_progress",
  "resolved",
  "duplicate_merged",
] as const;
export type ProblemStatus = (typeof PROBLEM_STATUS_ENUM)[number];

export const LOCATION_SOURCE_ENUM = ["gps", "manual"] as const;
export type LocationSource = (typeof LOCATION_SOURCE_ENUM)[number];

export const INSTITUTION_TYPE_ENUM = [
  "university",
  "college",
  "technical_institute",
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPE_ENUM)[number];

export const DATA_DEPTH_ENUM = ["shallow", "deep"] as const;
export type DataDepth = (typeof DATA_DEPTH_ENUM)[number];

export const PROJECT_STATUS_ENUM = [
  "claimed",
  "in_progress",
  "completed",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUS_ENUM)[number];

export const PLEDGE_TYPE_ENUM = [
  "mentorship",
  "funding",
  "prototyping",
] as const;
export type PledgeType = (typeof PLEDGE_TYPE_ENUM)[number];
