"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { VoiceInput } from "@/components/citizen/VoiceInput";
import { LocationPicker, type LocationValue } from "@/components/citizen/LocationPicker";
import { SubmissionResult, type SubmissionResponse } from "@/components/citizen/SubmissionResult";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResponse | null>(null);

  const tooShort = description.trim().length < MIN_DESCRIPTION;
  const canSubmit = !tooShort && location !== null && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!location || tooShort) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/problems", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          language,
          location: { lat: location.lat, lng: location.lng },
          locationSource: location.source,
          ...(location.source === "gps" && location.accuracyM !== null
            ? { locationAccuracyM: location.accuracyM }
            : {}),
          mediaUrls: [],
        }),
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
      // Offline or unreachable. The IndexedDB queue lands next; until then be
      // honest rather than pretending the report was saved.
      setError(
        "Could not send your report — you may be offline. Please try again when you have a connection.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setResult(null);
    setDescription("");
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
