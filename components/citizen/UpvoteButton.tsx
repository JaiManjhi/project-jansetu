"use client";

import { useState } from "react";
import { ArrowBigUp } from "lucide-react";

/**
 * Supports a report. Optimistic, because the wait is not interesting and the
 * failure is recoverable — but it rolls back on failure rather than leaving a
 * count that disagrees with the server.
 */
export function UpvoteButton({
  problemId,
  initialCount,
}: {
  problemId: string;
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);
  const [supported, setSupported] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function support() {
    if (supported) return;
    const previous = count;
    setCount(previous + 1);
    setSupported(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/problems/${problemId}/upvote`, { method: "POST" });
      if (!response.ok) {
        setCount(previous);
        setSupported(false);
        const body: unknown = await response.json().catch(() => null);
        setMessage(
          response.status === 429
            ? "You have already supported this one."
            : typeof body === "object" && body !== null && "error" in body
              ? String((body as { error: unknown }).error)
              : "Could not record that. Please try again.",
        );
        return;
      }
      const body = (await response.json()) as { upvoteCount: number };
      // Trust the server's number over the optimistic one — a merged report
      // redirects the increment to its parent, so these can legitimately differ.
      setCount(body.upvoteCount);
    } catch {
      setCount(previous);
      setSupported(false);
      setMessage("Could not record that — you may be offline.");
    }
  }

  return (
    <div className="shrink-0 text-center">
      <button
        type="button"
        onClick={support}
        disabled={supported}
        aria-label={`Support this report. Currently ${count} ${count === 1 ? "report" : "reports"}.`}
        className={`inline-flex min-h-touch w-16 flex-col items-center justify-center rounded-button border transition-colors ${
          supported
            ? "border-accent bg-accent-subtle text-accent"
            : "border-border bg-surface text-ink-600 hover:bg-accent-subtle hover:text-accent"
        }`}
      >
        <ArrowBigUp size={20} strokeWidth={1.5} aria-hidden />
        <span className="text-sm font-medium tabular-nums">{count}</span>
      </button>
      {message && (
        <p className="mt-1 w-16 text-xs text-ink-300" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
