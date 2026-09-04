"use client";

import { useState } from "react";
import { Languages, LoaderCircle } from "lucide-react";
import { LANGUAGE_NAMES, TRANSLATION_LANGUAGE_ENUM, type TranslationLanguage } from "@/lib/constants";

/**
 * Read a report in another language.
 *
 * The feed is a shared public record: a problem reported in Bengali in
 * Jamshedpur should be readable by someone in Ranchi who reads Hindi. Without
 * this the feed is only legible to whoever happens to share the reporter's
 * language, which quietly undoes the point of a common record.
 *
 * Translation is fetched on demand and cached server-side, so the first reader
 * waits about a second and everyone after them does not. The original is never
 * replaced — "Show original" is always one tap away, because a translation of a
 * civic complaint is a rendering of someone's words, not a correction of them.
 */

interface TranslateControlProps {
  problemId: string;
  /** The language the report was written in — never offered as a target. */
  sourceLanguage: string;
  title: string;
  description: string;
}

interface Shown {
  language: TranslationLanguage;
  title: string;
  description: string;
}

export function TranslateControl({
  problemId,
  sourceLanguage,
  title,
  description,
}: TranslateControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<TranslationLanguage | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targets = TRANSLATION_LANGUAGE_ENUM.filter((code) => code !== sourceLanguage);

  async function translate(target: TranslationLanguage) {
    setBusy(target);
    setError(null);
    try {
      const response = await fetch(`/api/problems/${problemId}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetLanguage: target }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message = (body as { error?: unknown } | null)?.error;
        setError(
          typeof message === "string"
            ? message
            : "Could not translate this report. Please try again.",
        );
        return;
      }

      const data = body as { title?: unknown; description?: unknown } | null;
      if (typeof data?.title !== "string" || typeof data.description !== "string") {
        setError("Could not translate this report. Please try again.");
        return;
      }
      setShown({ language: target, title: data.title, description: data.description });
      setOpen(false);
    } catch {
      setError("Could not reach the translation service. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3">
      {shown && (
        <div className="mb-3 border-l-2 border-accent bg-accent-subtle px-4 py-3">
          <p className="text-xs font-medium tracking-wide text-accent uppercase">
            {LANGUAGE_NAMES[shown.language].native}
          </p>
          <p className="mt-1 text-base font-medium text-ink-900">{shown.title}</p>
          <p className="mt-1 text-sm text-ink-600">{shown.description}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
          }}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 transition-colors hover:text-accent"
        >
          <Languages size={16} strokeWidth={1.5} aria-hidden />
          {shown ? "Read in another language" : "Translate"}
        </button>

        {shown && (
          <button
            type="button"
            onClick={() => setShown(null)}
            className="text-sm text-ink-300 underline underline-offset-2 transition-colors hover:text-accent"
          >
            Show original
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {targets.map((code) => (
            <button
              key={code}
              type="button"
              disabled={busy !== null}
              onClick={() => void translate(code)}
              className="inline-flex items-center gap-1.5 rounded-button border border-border bg-surface px-3 py-1.5 text-sm text-ink-900 transition-colors hover:bg-accent-subtle disabled:text-ink-300"
            >
              {busy === code && (
                <LoaderCircle size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
              )}
              {LANGUAGE_NAMES[code].native}
              <span className="text-ink-300">{LANGUAGE_NAMES[code].english}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-warning" role="alert">
          {error}
        </p>
      )}

      {/* Kept in the DOM so a translation never hides the original from a
          screen reader, which reads the source text regardless of what is
          displayed visually above it. */}
      <span className="sr-only">
        Original in {LANGUAGE_NAMES[sourceLanguage as TranslationLanguage]?.english ?? sourceLanguage}: {title}. {description}
      </span>
    </div>
  );
}
