import mongoose from "mongoose";
import type { Model, Types } from "mongoose";

// mongoose is CommonJS. Node ESM cannot see `models` as a named export (only
// webpack interop can), so destructure from the default export instead —
// this keeps the models importable from both Next and plain `node` scripts.
const { Schema, model, models } = mongoose;
import { ROLE_ENUM, type Role } from "../lib/constants.ts";

export interface UserDoc {
  _id: Types.ObjectId;
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  institutionId: Types.ObjectId | null;
  organizationName: string | null;
  createdAt: Date;
}

const UserSchema = new Schema<UserDoc>(
  {
    role: { type: String, enum: ROLE_ENUM, required: true },
    name: { type: String, required: true, trim: true },
    // Optional for citizens, required for every other role — enforced below.
    email: { type: String, default: null, lowercase: true, trim: true },
    phone: { type: String, default: null, trim: true },
    passwordHash: {
      type: String,
      default: null,
      // DATA_MODEL.md: excluded from every query unless explicitly selected.
      // Only the NextAuth authorize callback should ever ask for it.
      select: false,
    },
    institutionId: {
      type: Schema.Types.ObjectId,
      ref: "Institution",
      default: null,
    },
    organizationName: { type: String, default: null, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ role: 1 });

// The conditional-requirement rules from DATA_MODEL.md. Mongoose's `required`
// function form can express these, but a single validator keeps all four role
// rules readable in one place instead of scattered across paths.
UserSchema.pre("validate", function () {
  if (this.role !== "citizen") {
    if (!this.email) {
      throw new Error(`email is required for role "${this.role}"`);
    }
    if (!this.passwordHash) {
      throw new Error(`passwordHash is required for role "${this.role}"`);
    }
  }
  if (this.role === "university" && !this.institutionId) {
    throw new Error('institutionId is required for role "university"');
  }
  if (this.role === "industry" && !this.organizationName) {
    throw new Error('organizationName is required for role "industry"');
  }
});

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc>) ?? model<UserDoc>("User", UserSchema);
