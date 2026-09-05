"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { PLEDGE_TYPE_ENUM } from "@/lib/constants";

/**
 * Pledge form — PRD §5, "functional but simple", and §3: pledges are
 * RECORDED, not processed.
 *
 * The copy says so explicitly rather than leaving it implied. A partner
 * entering a funding figure should not be able to believe money moved, and a
 * judge asking "does this actually transfer funds?" should find the honest
 * answer on the screen rather than in a caveat slide.
 */

const TYPE_LABELS: Record<string, string> = {
  mentorship: "Mentorship",
  funding: "Funding",
  prototyping: "Prototyping support",
};

export function PledgeForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("mentorship");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/pledges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          type,
          note,
          // Only funding carries an amount; the API rejects it otherwise.
          amount: type === "funding" && amount ? Number(amount) : null,
        }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "Could not record your pledge.",
        );
        return;
      }
      setDone(true);
      setOpen(false);
      setNote("");
      setAmount("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done && !open) {
    return (
      <p className="mt-4 text-sm text-success" role="status">
        Pledge recorded. The coordinator can see it on this project.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex min-h-touch items-center rounded-button bg-accent px-5 text-base font-medium text-white transition-colors hover:bg-accent-deep"
      >
        Offer support
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-button border border-border bg-paper p-4">
      <fieldset>
        <legend className="text-sm font-medium text-ink-900">How can you help?</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {PLEDGE_TYPE_ENUM.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={`min-h-touch rounded-button border px-4 text-sm font-medium transition-colors ${
                type === t
                  ? "border-accent bg-accent-subtle text-accent"
                  : "border-border bg-surface text-ink-900 hover:bg-accent-subtle"
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </fieldset>

      {type === "funding" && (
        <div className="mt-4">
          <label htmlFor={`amount-${projectId}`} className="block text-sm font-medium text-ink-900">
            Amount (₹)
          </label>
          <input
            id={`amount-${projectId}`}
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-2 min-h-touch w-full rounded-button border border-border bg-surface px-3 text-base text-ink-900 sm:w-64"
          />
          <p className="mt-1 text-xs text-warning">
            Recorded as an intention only. No payment is taken and none is processed.
          </p>
        </div>
      )}

      <div className="mt-4">
        <label htmlFor={`note-${projectId}`} className="block text-sm font-medium text-ink-900">
          Note to the team
        </label>
        <textarea
          id={`note-${projectId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-2 w-full rounded-button border border-border bg-surface p-3 text-base text-ink-900"
        />
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-touch items-center gap-2 rounded-button bg-accent px-5 text-base font-medium text-white transition-colors hover:bg-accent-deep disabled:bg-ink-300"
        >
          {submitting && <LoaderCircle size={20} strokeWidth={1.5} className="animate-spin" aria-hidden />}
          {submitting ? "Recording…" : "Record pledge"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-touch rounded-button border border-border bg-surface px-5 text-base font-medium text-ink-900 transition-colors hover:bg-accent-subtle"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
