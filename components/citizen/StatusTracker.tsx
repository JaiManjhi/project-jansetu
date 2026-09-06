import { Check, Circle, CircleDot, CircleSlash } from "lucide-react";
import type { ProblemStatus } from "@/lib/constants";

/**
 * What happened to a report, as a vertical timeline.
 *
 * Built for the one person the product had no screen for: the citizen who
 * submitted something and wants to know whether anything came of it. PRD §6
 * asks that they "know what happened to it", and until now the answer lived
 * only in the database.
 *
 * Vertical rather than a horizontal stepper, because each stage carries a line
 * of explanation and horizontal steppers have nowhere to put it. It also
 * survives a narrow phone without shrinking the labels to nothing.
 *
 * The stages are derived from the problem's own status, which the project
 * routes keep in step (completing a project writes "resolved" back to the
 * problem). Nothing here is a separate progress field that could drift out of
 * agreement with the real state.
 */

type StageState = "done" | "current" | "upcoming" | "refused";

interface Stage {
  label: string;
  detail: string;
  state: StageState;
}

/**
 * How far a status has travelled. `processing` is deliberately ambiguous: it
 * covers both "just arrived, not yet classified" and "classified but nothing
 * scored high enough to route to", so the caller's category decides.
 */
const STAGE_OF: Record<ProblemStatus, number> = {
  processing: 1,
  routed: 2,
  claimed: 3,
  in_progress: 4,
  resolved: 5,
  // Never rendered as a timeline — the page redirects to the report this was
  // merged into, which is the one that is actually progressing.
  duplicate_merged: 1,
};

export interface StatusTrackerProps {
  status: ProblemStatus;
  category: string | null;
  categoryLabel: string | null;
  severityScore: number | null;
  reportedAt: Date;
  /** How many institutions it was routed to. 0 means routing found nothing. */
  routedCount: number;
  /** Institution that claimed it, once one has. */
  claimedBy: string | null;
  needsReview: boolean;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export function StatusTracker({
  status,
  category,
  categoryLabel,
  severityScore,
  reportedAt,
  routedCount,
  claimedBy,
  needsReview,
}: StatusTrackerProps) {
  const reached = STAGE_OF[status] ?? 0;
  const classified = category !== null;

  /**
   * Routing can end in three ways, and conflating them would be the easiest
   * place for this screen to lie. It can still be working, it can have found
   * institutions, or it can have found nothing good enough and stopped — the
   * refusal that AI_ENGINE.md §4 describes. A citizen is owed the difference.
   */
  const routingRefused = status === "processing" && classified && routedCount === 0;

  const stageState = (index: number): StageState => {
    if (index === 2 && routingRefused) return "refused";
    if (reached > index) return "done";
    if (reached === index) return "current";
    return "upcoming";
  };

  const stages: Stage[] = [
    {
      label: "Reported",
      detail: `Received on ${formatDate(reportedAt)}.`,
      state: "done",
    },
    {
      label: "Understood",
      detail: needsReview
        ? "Held for a person to review."
        : classified
          ? `Categorised as ${categoryLabel ?? category}${
              severityScore !== null ? `, severity ${severityScore} of 100` : ""
            }.`
          : "Being read and categorised.",
      state: needsReview ? "current" : classified ? "done" : "current",
    },
    {
      label: "Matched to an institution",
      detail: routingRefused
        ? "No institution on record was a close enough match, so this was not routed rather than sent somewhere unsuitable. It stays visible for review."
        : routedCount > 0
          ? `Sent to ${routedCount} ${routedCount === 1 ? "institution" : "institutions"} best equipped to work on it.`
          : "Looking for the department best equipped to work on this.",
      state: stageState(2),
    },
    {
      label: "Claimed",
      detail: claimedBy
        ? `${claimedBy} has taken this on.`
        : "Waiting for an institution to take it on.",
      state: stageState(3),
    },
    {
      label: "Work in progress",
      detail:
        reached >= 4 ? "The institution has started work." : "Not started yet.",
      state: stageState(4),
    },
    {
      label: "Resolved",
      detail: reached >= 5 ? "Marked resolved by the institution." : "Not yet.",
      state: stageState(5),
    },
  ];

  return (
    <ol className="mt-6">
      {stages.map((stage, index) => {
        const last = index === stages.length - 1;
        return (
          <li key={stage.label} className="flex gap-4">
            {/* Marker column: the icon plus the line that joins it to the next
                stage. The line is on the marker, not between rows, so it cannot
                drift out of alignment when a detail line wraps. */}
            <div className="flex flex-col items-center">
              <StageIcon state={stage.state} />
              {!last && (
                <span
                  className={`w-px flex-1 ${
                    stage.state === "done" ? "bg-accent" : "bg-border"
                  }`}
                  aria-hidden
                />
              )}
            </div>

            <div className={last ? "pb-1" : "pb-8"}>
              <p
                className={`text-base font-medium ${
                  stage.state === "upcoming" ? "text-ink-300" : "text-ink-900"
                }`}
              >
                {stage.label}
              </p>
              <p
                className={`mt-1 max-w-prose text-sm ${
                  stage.state === "refused" ? "text-warning" : "text-ink-600"
                }`}
              >
                {stage.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StageIcon({ state }: { state: StageState }) {
  const common = "size-5 shrink-0";
  if (state === "done") {
    return <Check size={20} strokeWidth={2} className={`${common} text-accent`} aria-hidden />;
  }
  if (state === "current") {
    return <CircleDot size={20} strokeWidth={2} className={`${common} text-accent`} aria-hidden />;
  }
  if (state === "refused") {
    return (
      <CircleSlash size={20} strokeWidth={1.75} className={`${common} text-warning`} aria-hidden />
    );
  }
  return <Circle size={20} strokeWidth={1.5} className={`${common} text-ink-300`} aria-hidden />;
}
