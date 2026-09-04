"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldOff, RotateCcw, LoaderCircle } from "lucide-react";
import { REMOVAL_REASON_ENUM, REMOVAL_REASON_LABELS, type RemovalReason } from "@/lib/constants";

/**
 * Take a report down, or put it back. Admin only.
 *
 * Deliberately placed on the report itself in the feed rather than on a
 * separate moderation screen: the decision to remove something is made while
 * looking at it, and a queue you have to navigate to is a queue nobody opens.
 *
 * The button is only rendered for admins, but that is presentation only —
 * PATCH /api/problems/:id/moderation checks the role server-side, because a
 * hidden button is not access control.
 */

interface ModerationControlProps {
  problemId: string;
  /** Current state, so the control can offer Remove or Restore. */
  removed: boolean;
  removedReason?: string | null;
}

export function ModerationControl({ problemId, removed, removedReason }: ModerationControlProps) {
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/problems/${problemId}/moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data: unknown = await response.json().catch(() => null);
        const message = (data as { error?: unknown } | null)?.error;
        setError(typeof message === "string" ? message : "Could not update this report.");
        return;
      }
      setChoosing(false);
      // Re-fetch the server component so the card disappears from (or returns
      // to) the feed immediately, rather than lying until the next navigation.
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (removed) {
    return (
      <div className="mt-3 border-l-2 border-warning bg-surface px-4 py-3">
        <p className="text-sm font-medium text-warning">
          Removed from the public feed
          {removedReason && (
            <span className="font-normal text-ink-600">
              {" "}
              · {REMOVAL_REASON_LABELS[removedReason as RemovalReason] ?? removedReason}
            </span>
          )}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({ removed: false })}
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-600 transition-colors hover:text-accent disabled:text-ink-300"
        >
          {busy ? (
            <LoaderCircle size={15} strokeWidth={1.5} className="animate-spin" aria-hidden />
          ) : (
            <RotateCcw size={15} strokeWidth={1.5} aria-hidden />
          )}
          Restore to the feed
        </button>
        {error && (
          <p className="mt-2 text-sm text-warning" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {!choosing ? (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          className="inline-flex items-center gap-1.5 text-sm text-ink-300 transition-colors hover:text-warning"
        >
          <ShieldOff size={15} strokeWidth={1.5} aria-hidden />
          Remove
        </button>
      ) : (
        <div className="border border-border bg-surface p-3">
          <p className="text-sm font-medium text-ink-900">Why is this being removed?</p>
          <p className="mt-1 text-sm text-ink-600">
            It leaves the public feed and every institution queue. Nothing is deleted — you can
            restore it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {REMOVAL_REASON_ENUM.map((reason) => (
              <button
                key={reason}
                type="button"
                disabled={busy}
                onClick={() => void send({ removed: true, reason })}
                className="rounded-button border border-border px-3 py-1.5 text-sm text-ink-900 transition-colors hover:border-warning hover:text-warning disabled:text-ink-300"
              >
                {REMOVAL_REASON_LABELS[reason]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setChoosing(false)}
            disabled={busy}
            className="mt-3 text-sm text-ink-300 underline underline-offset-2 hover:text-accent"
          >
            Cancel
          </button>
          {error && (
            <p className="mt-2 text-sm text-warning" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
