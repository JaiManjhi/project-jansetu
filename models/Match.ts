import mongoose from "mongoose";
import type { Model, Types } from "mongoose";

// mongoose is CommonJS. Node ESM cannot see `models` as a named export (only
// webpack interop can), so destructure from the default export instead —
// this keeps the models importable from both Next and plain `node` scripts.
const { Schema, model, models } = mongoose;

export interface MatchDoc {
  _id: Types.ObjectId;
  problemId: Types.ObjectId;
  institutionId: Types.ObjectId;
  score: number;
  distanceKm: number;
  /** Selected in AI_ENGINE.md §4 step 4. null for shallow institutions,
   *  which carry no department data at all. */
  matchedDepartment: string | null;
  reason: string;
  rank: number;
  createdAt: Date;
}

const MatchSchema = new Schema<MatchDoc>(
  {
    problemId: {
      type: Schema.Types.ObjectId,
      ref: "Problem",
      required: true,
    },
    institutionId: {
      type: Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },
    score: { type: Number, required: true },
    distanceKm: { type: Number, required: true, min: 0 },
    matchedDepartment: { type: String, default: null, trim: true },
    reason: { type: String, required: true, trim: true },
    rank: { type: Number, required: true, min: 1, max: 3 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

MatchSchema.index({ problemId: 1, rank: 1 });

export const Match: Model<MatchDoc> =
  (models.Match as Model<MatchDoc>) ?? model<MatchDoc>("Match", MatchSchema);
