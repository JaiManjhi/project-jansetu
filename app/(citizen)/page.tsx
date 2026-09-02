"use client";

import { useState } from "react";
import { LoaderCircle, WifiOff, Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { VoiceInput } from "@/components/citizen/VoiceInput";
import { LocationPicker, type LocationValue } from "@/components/citizen/LocationPicker";
import { SubmissionResult, type SubmissionResponse } from "@/components/citizen/SubmissionResult";
import { useOfflineQueue, ServiceWorkerRegistrar } from "@/components/citizen/OfflineQueueProvider";
import { enqueue, isSupported as queueSupported } from "@/lib/offline-queue";
import { PhotoUpload } from "@/components/citizen/PhotoUpload";

/**
 * Citizen submission — DESIGN.md §8.
 *
 * Mobile-first, single column, one obvious next action per screen. Written for
 * someone standing in a field on a phone, so: no login, generous touch
 * targets, visible labels rather than placeholder-as-label (§9), and plain
 * language throughout.
 */

const MIN_DESCRIPTION = 10;

export default function ReportProblemPage() {
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("en");
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [queuedNotice, setQueuedNotice] = useState(false);
  const { online, queued, flushing, refresh } = useOfflineQueue();

  const tooShort = description.trim().length < MIN_DESCRIPTION;
  const canSubmit = !tooShort && location !== null && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!location || tooShort) return;

    setSubmitting(true);
    setError(null);
    setQueuedNotice(false);

    const payload = {
      description: description.trim(),
      language,
      location: { lat: location.lat, lng: location.lng },
      locationSource: location.source,
      ...(location.source === "gps" && location.accuracyM !== null
        ? { locationAccuracyM: location.accuracyM }
        : {}),
      mediaUrls,
    };

    // Known offline: queue without attempting the request. PRD §6 — the
    // report is kept, not lost, and the citizen is told so plainly.
    if (!online && queueSupported()) {
      await enqueue(payload);
      await refresh();
      setQueuedNotice(true);
      setDescription("");
      setMediaUrls([]);
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/problems", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "Something went wrong. Please try again.";
        setError(message);
        return;
      }
      setResult(body as SubmissionResponse);
    } catch {
      // The connection dropped mid-request. Queue rather than lose it, and only
      // claim it was saved if the queue actually accepted it.
      if (queueSupported()) {
        try {
          await enqueue(payload);
          await refresh();
          setQueuedNotice(true);
          setDescription("");
          setMediaUrls([]);
        } catch {
          setError("Could not send or save your report. Please try again when you have a connection.");
        }
      } else {
        setError("Could not send your report — you may be offline. Please try again when you have a connection.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setResult(null);
    setDescription("");
    setMediaUrls([]);
    setError(null);
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <p className="text-sm font-medium tracking-wide text-accent uppercase">JanSetu</p>
        <h1 className="font-display mt-2 text-2xl text-ink-900">Report a problem</h1>
        <p className="mt-3 text-base text-ink-600">
          Tell us what is wrong in your area. It goes to the university best
          placed to work on it. No account needed.
        </p>
      </header>

      <ServiceWorkerRegistrar />

      {/* PRD §6 — offline must be visible before the citizen writes anything,
          not sprung on them at submit time. */}
      {!online && (
        <p
          className="mt-6 flex items-start gap-2 rounded-button border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
          role="status"
        >
          <WifiOff size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            You are offline. You can still fill this in — your report is saved
            on this device and sent automatically when you are back online.
          </span>
        </p>
      )}

      {/* PRD §6 — the "queued, will send" state, stated plainly. */}
      {queuedNotice && (
        <div className="mt-6 rounded-card border border-border bg-surface p-4">
          <p className="flex items-start gap-2 text-base text-ink-900">
            <Clock size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>Saved on this device — it will send by itself.</span>
          </p>
          <p className="mt-2 text-sm text-ink-600">
            Your report is safe. You do not need to do anything: it goes out as
            soon as you have a connection, even if you close this page.
          </p>
        </div>
      )}

      {queued > 0 && !queuedNotice && (
        <p className="mt-6 text-sm text-ink-600" role="status">
          {queued} {queued === 1 ? "report is" : "reports are"} waiting to send
          {flushing ? " — sending now…" : online ? "" : " — will send when you are back online"}.
        </p>
      )}

      {result ? (
        <div className="mt-8">
          <SubmissionResult result={result} onReset={reset} />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-8" noValidate>
          <section>
            <label htmlFor="description" className="block text-base font-medium text-ink-900">
              What is the problem?
            </label>
            <p id="description-help" className="mt-1 text-sm text-ink-600">
              Describe it in your own words — where it is, how long it has been
              like this, and who it affects.
            </p>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby="description-help"
              rows={5}
              className="mt-3 w-full rounded-button border border-border bg-surface p-3 text-base text-ink-900 placeholder:text-ink-300"
              placeholder="The hand pump near the school has been broken for three months…"
            />

            <div className="mt-3">
              <VoiceInput
                language={language}
                onTranscript={(text) =>
                  setDescription((current) => (current ? `${current} ${text}` : text))
                }
              />
            </div>
          </section>

          <section>
            <span className="block text-base font-medium text-ink-900">Language</span>
            <p className="mt-1 text-sm text-ink-600">
              Used for voice input, and recorded with your report.
            </p>
            <div className="mt-3 flex gap-3">
              {[
                { code: "en", label: "English" },
                { code: "hi", label: "हिंदी" },
              ].map((option) => (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => setLanguage(option.code)}
                  aria-pressed={language === option.code}
                  className={`min-h-touch rounded-button border px-5 text-base font-medium transition-colors ${
                    language === option.code
                      ? "border-accent bg-accent-subtle text-accent"
                      : "border-border bg-surface text-ink-900 hover:bg-accent-subtle"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <span className="block text-base font-medium text-ink-900">Add a photo (optional)</span>
            <p className="mt-1 text-sm text-ink-600">
              A picture helps the people who will work on this understand it faster.
            </p>
            <div className="mt-3">
              <PhotoUpload urls={mediaUrls} onChange={setMediaUrls} disabled={submitting} />
            </div>
          </section>

          <section>
            <span className="block text-base font-medium text-ink-900">Where is it?</span>
            <p className="mt-1 text-sm text-ink-600">
              We check your location automatically. Move the pin if it is not exact.
            </p>
            <div className="mt-3">
              <LocationPicker value={location} onChange={setLocation} />
            </div>
          </section>

          {error && (
            <p className="rounded-button border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <div>
            <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
              {submitting && (
                <LoaderCircle size={20} strokeWidth={1.5} className="animate-spin" aria-hidden />
              )}
              {submitting ? "Sending…" : "Submit report"}
            </Button>

            {/* Say why the button is disabled instead of leaving it inert. */}
            {!canSubmit && !submitting && (
              <p className="mt-3 text-sm text-ink-600">
                {tooShort
                  ? "Add a little more detail before submitting."
                  : "Set the location on the map before submitting."}
              </p>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
