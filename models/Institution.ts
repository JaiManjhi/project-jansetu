import { Schema, model, models, type Model, type Types } from "mongoose";
import {
  DATA_DEPTH_ENUM,
  INSTITUTION_TYPE_ENUM,
  type DataDepth,
  type InstitutionType,
} from "@/lib/constants";
import type { GeoPoint } from "./Problem";

export interface DepartmentSubdoc {
  name: string;
  facultyExpertise: string[];
  /** Vector for this department's own text. Powers matched-department
   *  selection in AI_ENGINE.md §4 — compared in JS, never indexed by Atlas. */
  embedding: number[];
  activeProjectCount: number;
}

export interface InstitutionDoc {
  _id: Types.ObjectId;
  name: string;
  type: InstitutionType;
  state: string;
  district: string;
  location: GeoPoint;
  dataDepth: DataDepth;
  departments: DepartmentSubdoc[];
  capabilityText: string;
  capabilityEmbedding: number[];
  contactEmail: string | null;
  verifiedDomain: string | null;
  createdAt: Date;
}

const DepartmentSchema = new Schema<DepartmentSubdoc>(
  {
    name: { type: String, required: true, trim: true },
    facultyExpertise: { type: [String], default: [] },
    embedding: { type: [Number], default: [] },
    // Incremented only by the claim route, decremented only on transition to
    // "completed" — see API_SPEC.md. If this bookkeeping is skipped the
    // routing load penalty is permanently zero and still looks like it works.
    activeProjectCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const InstitutionSchema = new Schema<InstitutionDoc>(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: INSTITUTION_TYPE_ENUM, required: true },
    state: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
        default: "Point",
      },
      // [lng, lat] — same order trap as Problem.location.
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
            "location.coordinates must be [lng, lat] — a failure here usually means the pair was swapped",
        },
      },
    },
    dataDepth: { type: String, enum: DATA_DEPTH_ENUM, required: true },
    departments: { type: [DepartmentSchema], default: [] },
    capabilityText: { type: String, required: true, trim: true },
    capabilityEmbedding: { type: [Number], default: [] },
    contactEmail: { type: String, default: null, lowercase: true, trim: true },
    verifiedDomain: { type: String, default: null, lowercase: true, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

InstitutionSchema.index({ location: "2dsphere" });
InstitutionSchema.index({ state: 1 });

export const Institution: Model<InstitutionDoc> =
  (models.Institution as Model<InstitutionDoc>) ??
  model<InstitutionDoc>("Institution", InstitutionSchema);
