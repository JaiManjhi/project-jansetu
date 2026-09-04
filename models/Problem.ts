import mongoose from "mongoose";
import type { Model, Types } from "mongoose";

// mongoose is CommonJS. Node ESM cannot see `models` as a named export (only
// webpack interop can), so destructure from the default export instead —
// this keeps the models importable from both Next and plain `node` scripts.
const { Schema, model, models } = mongoose;
import {
  CATEGORY_ENUM,
  LOCATION_SOURCE_ENUM,
  PROBLEM_STATUS_ENUM,
  type Category,
  type LocationSource,
  type ProblemStatus,
} from "../lib/constants.ts";

/** GeoJSON Point. coordinates are [lng, lat] — see the warning below. */
export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface ProblemDoc {
  _id: Types.ObjectId;
  title: string;
  description: string;
  language: string;
  /** Cached on-demand translations, keyed by target language code. */
  translations: Record<string, { title: string; description: string; translatedAt: Date }>;
  category: Category | null;
  severityScore: number | null;
  location: GeoPoint;
  locationSource: LocationSource;
  locationAccuracyM: number | null;
  district: string;
  state: string;
  mediaUrls: string[];
  submittedBy: Types.ObjectId | null;
  status: ProblemStatus;
  needsReview: boolean;
  duplicateOf: Types.ObjectId | null;
  upvoteCount: number;
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

const ProblemSchema = new Schema<ProblemDoc>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    language: { type: String, required: true, default: "en", trim: true },

    /**
     * DATA_MODEL.md — written only by POST /api/problems/:id/translate.
     *
     * Mixed type rather than a sub-schema: the keys are language codes, not
     * fixed field names, and Mongoose sub-schemas cannot express a map whose
     * keys are data. `default: {}` matters — without it an untranslated problem
     * has `undefined` here and every read site needs a guard.
     */
    translations: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },

    // null only while unclassified — always paired with needsReview: true.
    category: { type: String, enum: [...CATEGORY_ENUM, null], default: null },
    severityScore: { type: Number, min: 0, max: 100, default: null },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
        default: "Point",
      },
      // ⚠ [lng, lat], NOT [lat, lng]. API_SPEC.md flags this as a silent-bug
      // point: the wrong order still saves fine and still reads back fine —
      // it only shows up as every pin landing in the wrong place on the map.
      // The lat/lng bounds below are the cheap tripwire: a swapped Indian
      // coordinate pair puts lat ≈ 85, which is outside [-90, 90] only for
      // some of the country, so the validator catches many but not all
      // swaps. lib/geo has the real conversion; the test asserts it.
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (v: number[]) =>
            v.length === 2 &&
            v[0] >= -180 &&
            v[0] <= 180 &&
            v[1] >= -90 &&
            v[1] <= 90,
          message:
            "location.coordinates must be [lng, lat] with lng in [-180,180] and lat in [-90,90] — a failure here usually means the pair was swapped",
        },
      },
    },

    locationSource: {
      type: String,
      enum: LOCATION_SOURCE_ENUM,
      required: true,
    },
    locationAccuracyM: { type: Number, default: null, min: 0 },

    // Both derived server-side from location. Never read from the request body.
    district: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },

    mediaUrls: { type: [String], default: [] },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    status: {
      type: String,
      enum: PROBLEM_STATUS_ENUM,
      required: true,
      default: "processing",
    },
    needsReview: { type: Boolean, required: true, default: false },
    duplicateOf: { type: Schema.Types.ObjectId, ref: "Problem", default: null },
    upvoteCount: { type: Number, required: true, default: 0, min: 0 },

    // Absent (not empty) until generated — an unembedded problem must be
    // invisible to dedup rather than a zero-vector that matches everything.
    embedding: { type: [Number], required: false },
  },
  { timestamps: true },
);

ProblemSchema.index({ location: "2dsphere" });
ProblemSchema.index({ district: 1, createdAt: -1 });
ProblemSchema.index({ needsReview: 1, createdAt: -1 });

/**
 * The two Atlas Vector Search indexes are NOT created here. Mongoose cannot
 * define them — they are Atlas search indexes, created via the Atlas UI or the
 * Admin API. The exact JSON for `problem_embedding_index`, including the three
 * required `filter` fields, is in DATA_MODEL.md. A missing filter field fails
 * at query time, not at index-creation time.
 */

export const Problem: Model<ProblemDoc> =
  (models.Problem as Model<ProblemDoc>) ??
  model<ProblemDoc>("Problem", ProblemSchema);
