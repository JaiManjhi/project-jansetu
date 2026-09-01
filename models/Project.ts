import { Schema, model, models, type Model, type Types } from "mongoose";
import { PROJECT_STATUS_ENUM, type ProjectStatus } from "@/lib/constants";

export interface ProjectDoc {
  _id: Types.ObjectId;
  problemId: Types.ObjectId;
  institutionId: Types.ObjectId;
  claimedBy: Types.ObjectId;
  /** Copied from the matches doc at claim time so completion decrements the
   *  same department the claim incremented. See API_SPEC.md. */
  matchedDepartment: string | null;
  teamMembers: string[];
  status: ProjectStatus;
  statusNote: string;
  claimedAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<ProjectDoc>(
  {
    problemId: { type: Schema.Types.ObjectId, ref: "Problem", required: true },
    institutionId: {
      type: Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },
    claimedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    matchedDepartment: { type: String, default: null, trim: true },
    teamMembers: { type: [String], default: [] },
    status: {
      type: String,
      enum: PROJECT_STATUS_ENUM,
      required: true,
      default: "claimed",
    },
    statusNote: { type: String, default: "", trim: true },
  },
  { timestamps: { createdAt: "claimedAt", updatedAt: true } },
);

ProjectSchema.index({ institutionId: 1, status: 1 });
// Unique, and load-bearing: this is what actually prevents two institutions
// claiming the same problem in a race. The claim route creates the project
// first and lets a duplicate-key error reject the loser with 409, rather than
// doing a read-then-write check, which has a window.
ProjectSchema.index({ problemId: 1 }, { unique: true });

export const Project: Model<ProjectDoc> =
  (models.Project as Model<ProjectDoc>) ??
  model<ProjectDoc>("Project", ProjectSchema);
