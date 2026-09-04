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

/**
 * Languages a citizen can SPEAK to JanSetu in — PRD.md §7.
 *
 * Every code here was verified against the live Groq Whisper endpoint on
 * 2026-09-04 rather than taken from a support matrix: each returns 200, and
 * `or` (Odia) returns 400 `unsupported language: or`, which is why Odia appears
 * in TRANSLATION_LANGUAGE_ENUM below but not here.
 *
 * PRD §7 asks for Hindi, English and one verified regional language, and warns
 * against claiming coverage that has not been tested. Bengali and Marathi are
 * both offered because both are accepted by the transcriber — but "accepted by
 * the API" is not "verified with real speech", and only English has been tested
 * end to end with an actual recording. Say that plainly in the pitch.
 */
export const VOICE_LANGUAGE_ENUM = ["en", "hi", "bn", "mr"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGE_ENUM)[number];

/**
 * Languages a report can be READ in. A superset of the above: translation goes
 * through the LLM, which handles Odia correctly even though Whisper cannot hear
 * it.
 */
export const TRANSLATION_LANGUAGE_ENUM = ["en", "hi", "bn", "mr", "or"] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGE_ENUM)[number];

/**
 * Display names. The endonym is what a speaker actually recognises — someone
 * looking for Bengali is looking for "বাংলা", not for the word "Bengali" — so it
 * leads, with the English name alongside for anyone navigating a script they
 * cannot read.
 */
export const LANGUAGE_NAMES: Record<TranslationLanguage, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  hi: { native: "हिंदी", english: "Hindi" },
  bn: { native: "বাংলা", english: "Bengali" },
  mr: { native: "मराठी", english: "Marathi" },
  or: { native: "ଓଡ଼ିଆ", english: "Odia" },
};

export function isTranslationLanguage(value: string): value is TranslationLanguage {
  return (TRANSLATION_LANGUAGE_ENUM as readonly string[]).includes(value);
}

export function isVoiceLanguage(value: string): value is VoiceLanguage {
  return (VOICE_LANGUAGE_ENUM as readonly string[]).includes(value);
}

/**
 * Why a report was taken down. Recorded on every removal, never free text
 * alone — a fixed list is what makes "how much of this is spam vs abuse?" a
 * question an admin can actually answer later.
 */
export const REMOVAL_REASON_ENUM = [
  "abusive",
  "spam",
  "personal_information",
  "not_a_civic_problem",
  "other",
] as const;
export type RemovalReason = (typeof REMOVAL_REASON_ENUM)[number];

export const REMOVAL_REASON_LABELS: Record<RemovalReason, string> = {
  abusive: "Abusive or offensive",
  spam: "Spam",
  personal_information: "Contains personal information",
  not_a_civic_problem: "Not a civic problem",
  other: "Other",
};

/**
 * The single definition of "the public may see this report".
 *
 * Spread into every public read rather than written inline, because there are
 * ten such paths and the failure mode of the inline version is silent: miss one
 * and removed content stays reachable through it. The two that are easiest to
 * forget are translation and upvote — a removed report that can still be
 * translated is still readable, just in a different language.
 *
 * `removedAt: null` matches documents written before this field existed as well
 * as visible ones, because MongoDB treats a missing field and an explicit null
 * identically here. That is what makes this safe to add to a live collection
 * without a migration.
 */
export const VISIBLE_PROBLEM_FILTER = { removedAt: null } as const;
