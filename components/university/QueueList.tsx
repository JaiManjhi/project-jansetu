"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MapPin } from "lucide-react";
import type { Category } from "@/lib/constants";

/**
 * The coordinator's queue — PRD §6.
 *
 * Every card leads with the match REASON, not the score. A coordinator
 * deciding whether to take on a piece of work needs to know why it reached
 * them; "0.41" tells them nothing. The score is shown, but quietly.
 */

export interface QueueEntry {
  problem: {
    _id: string;
    title: string;
    description: string;
    district: string;
    state: string;
    // Category, not string — a widened type here breaks the narrowing where
    // the server component builds these entries.
    category: Category | null;
    severityScore: number | null;
    upvoteCount: number;
  };
  match: {
    score: number;
    distanceKm: number;
    matchedDepartment: string | null;
    reason: string;
  };
}

export function QueueList({
  entries,
  institutionId,
}: {
  entries: QueueEntry[];
  institutionId: string;
}) {
  const router = useRouter();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function claim(problemId: string) {
    setClaiming(problemId);
    setError(null);
    try {
      const response = await fetch(`/api/institutions/${institutionId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "Could not claim this problem.",
        );
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setClaiming(null);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="mt-6 rounded-card border border-border bg-surface p-6">
        <p className="text-base text-ink-900">No problems are waiting for your institution.</p>
        <p className="mt-2 max-w-prose text-sm text-ink-600">
          Problems appear here once a citizen reports one that matches your
          departments&apos; expertise. Nothing is hidden — an empty queue means
          nothing has been routed here yet.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p className="mt-6 rounded-button border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <ul className="mt-6 space-y-4">
        {entries.map(({ problem, match }) => (
          <li key={problem._id} className="rounded-card border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium text-ink-900">{problem.title}</h3>
                <p className="mt-2 text-sm text-ink-600">{problem.description}</p>
              </div>
              <button
                type="button"
                onClick={() => void claim(problem._id)}
                disabled={claiming !== null}
                className="inline-flex min-h-touch shrink-0 items-center gap-2 rounded-button bg-accent px-5 text-base font-medium text-white transition-colors hover:bg-[#a84a1a] disabled:bg-ink-300"
              >
                {claiming === problem._id && (
                  <LoaderCircle size={20} strokeWidth={1.5} className="animate-spin" aria-hidden />
                )}
                {claiming === problem._id ? "Claiming…" : "Claim"}
              </button>
            </div>

            {/* The reason is the point of this screen. */}
            <p className="mt-4 rounded-button border border-border bg-accent-subtle p-3 text-sm text-ink-900">
              {match.reason}
            </p>

            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-300">
              <span className="flex items-center gap-1.5">
                <MapPin size={16} strokeWidth={1.5} aria-hidden />
                {problem.district}, {problem.state}
              </span>
              <span>{match.distanceKm} km away</span>
              {match.matchedDepartment && (
                <span className="text-ink-600">{match.matchedDepartment}</span>
              )}
              {problem.upvoteCount > 0 && (
                <span>
                  {problem.upvoteCount + 1} people reported this
                </span>
              )}
              <span>match {match.score.toFixed(2)}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
