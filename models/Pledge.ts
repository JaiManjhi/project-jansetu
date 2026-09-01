import { Schema, model, models, type Model, type Types } from "mongoose";
import { PLEDGE_TYPE_ENUM, type PledgeType } from "@/lib/constants";

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
