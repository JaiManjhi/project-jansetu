"use client";

import { motion } from "motion/react";
import { CheckCircle2, GitMerge, Clock } from "lucide-react";

/**
 * The response moment. Three shapes, per API_SPEC.md.
 *
 * The duplicate case is the one DESIGN.md §7 singles out as worth a deliberate,
 * visible transition — it is the moment the product's intelligence becomes
 * legible to a citizen (and to a judge). It animates in rather than simply
 * appearing. Everything else here stays still.
 */

export interface SubmissionResponse {
  problemId: string;
  status: "routed" | "duplicate_merged" | "processing";
  category: string | null;
  district: string;
  state: string;
  needsReview: boolean;
  duplicateOf: string | null;
  duplicate?: {
    problemId: string;
    title: string;
    upvoteCount: number;
    similarity: number;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  water_resources: "Water",
  healthcare: "Healthcare",
  education: "Education",
  agriculture: "Agriculture",
  environment: "Environment",
  energy: "Energy",
  urban_infrastructure: "Infrastructure",
  accessibility: "Accessibility",
  public_administration: "Administration",
  rural_livelihoods: "Livelihoods",
};

export function SubmissionResult({
  result,
  onReset,
}: {
  result: SubmissionResponse;
  onReset: () => void;
}) {
  if (result.status === "duplicate_merged" && result.duplicate) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        // 200ms, easeOut, no bounce — DESIGN.md §7 rules out anything springy.
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="rounded-card border border-border bg-surface p-6"
      >
        <div className="flex items-start gap-3">
          <GitMerge size={20} strokeWidth={1.5} className="mt-1 shrink-0 text-accent" aria-hidden />
          <div>
            <h2 className="font-display text-xl text-ink-900">
              Someone already reported this
            </h2>
            <p className="mt-2 text-base text-ink-600">
              Your report has been added as support for an existing one, so it
              counts toward getting it solved rather than sitting in a queue twice.
            </p>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: "easeOut", delay: 0.15 }}
          className="mt-5 rounded-button border border-border bg-accent-subtle p-4"
        >
          <p className="text-base text-ink-900">{result.duplicate.title}</p>
          <p className="mt-2 text-sm text-ink-600">
            {/* upvoteCount counts SUPPORTING reports and starts at 0, so the
                original reporter is not in it. Total people = count + 1.
                Showing the raw count undercounts by one and reads wrong the
                very first time a duplicate is detected — which is exactly the
                moment being demoed. */}
            {result.duplicate.upvoteCount + 1} people have now reported this in{" "}
            {result.district}.
          </p>
        </motion.div>

        <Actions onReset={onReset} />
      </motion.div>
    );
  }

  // Classified but awaiting routing, or held for manual review. Both are
  // honest "received" states — never an error, per AI_ENGINE.md §7.
  const pending = result.status === "processing";

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <div className="flex items-start gap-3">
        {pending ? (
          <Clock size={20} strokeWidth={1.5} className="mt-1 shrink-0 text-warning" aria-hidden />
        ) : (
          <CheckCircle2 size={20} strokeWidth={1.5} className="mt-1 shrink-0 text-success" aria-hidden />
        )}
        <div>
          <h2 className="font-display text-xl text-ink-900">Report received</h2>
          <p className="mt-2 text-base text-ink-600">
            {result.needsReview
              ? "We have saved your report. It will be reviewed by a person shortly."
              : "Your report has been recorded and is being matched to an institution."}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-ink-300">Location</dt>
          <dd className="mt-1 text-ink-900">
            {result.district}, {result.state}
          </dd>
        </div>
        <div>
          <dt className="text-ink-300">Category</dt>
          <dd className="mt-1 text-ink-900">
            {result.category
              ? (CATEGORY_LABELS[result.category] ?? result.category)
              : "Awaiting review"}
          </dd>
        </div>
      </dl>

      <Actions onReset={onReset} />
    </div>
  );
}

function Actions({ onReset }: { onReset: () => void }) {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onReset}
        className="inline-flex min-h-touch items-center rounded-button bg-accent px-5 text-base font-medium text-white transition-colors hover:bg-accent-deep"
      >
        Report another problem
      </button>
    </div>
  );
}
