import mongoose from "mongoose";
import type { Model, Types } from "mongoose";

// mongoose is CommonJS. Node ESM cannot see `models` as a named export (only
// webpack interop can), so destructure from the default export instead —
// this keeps the models importable from both Next and plain `node` scripts.
const { Schema, model, models } = mongoose;
import { PLEDGE_TYPE_ENUM, type PledgeType } from "../lib/constants.ts";

export interface PledgeDoc {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  partnerId: Types.ObjectId;
  type: PledgeType;
  note: string;
  amount: number | null;
  createdAt: Date;
}

const PledgeSchema = new Schema<PledgeDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    partnerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: PLEDGE_TYPE_ENUM, required: true },
    note: { type: String, default: "", trim: true },
    // Only meaningful when type === "funding" — enforced below.
    amount: { type: Number, default: null, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

PledgeSchema.index({ projectId: 1 });

PledgeSchema.pre("validate", function () {
  if (this.type !== "funding" && this.amount !== null) {
    throw new Error('amount may only be set when type is "funding"');
  }
});

export const Pledge: Model<PledgeDoc> =
  (models.Pledge as Model<PledgeDoc>) ??
  model<PledgeDoc>("Pledge", PledgeSchema);
