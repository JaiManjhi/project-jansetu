"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";

/**
 * Voice input via the browser-native Web Speech API — ARCHITECTURE.md §3.
 * Zero backend, zero API key, so it ships first. Whisper-on-Groq is the
 * upgrade path if Day 6-7 has slack, not a prerequisite.
 *
 * PRD §6 acceptance: the transcription is visible and EDITABLE before submit.
 * That is the whole point — speech recognition on Indian-accented Hindi and
 * English is imperfect, and a citizen must be able to correct it rather than
 * submit whatever the browser guessed.
 */

// Not in lib.dom: the API is still vendor-prefixed in Chromium and absent in
// Firefox. Declared minimally rather than pulling in a types package.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface VoiceInputProps {
  language: string;
  /** Appends recognised text to whatever the citizen has already typed. */
  onTranscript: (text: string) => void;
}

export function VoiceInput({ language, onTranscript }: VoiceInputProps) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  /**
   * Feature detection without an effect.
   *
   * The obvious `useEffect(() => setSupported(...), [])` sets state
   * synchronously in an effect body, which triggers a cascading render (React
   * flags it). A lazy useState initialiser would run during render and touch
   * `window`, breaking SSR. useSyncExternalStore is the construct built for
   * exactly this: a server snapshot of `false`, a client snapshot read from
   * the browser, and no subscription because support never changes.
   */
  const supported = useSyncExternalStore(
    () => () => {},
    () => getRecognitionCtor() !== null,
    () => false,
  );

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    setError(null);
    const recognition = new Ctor();
    recognition.lang = language === "hi" ? "hi-IN" : "en-IN";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) finalText += result[0].transcript;
      }
      if (finalText.trim()) onTranscript(finalText.trim());
    };

    recognition.onerror = (event) => {
      setError(
        event.error === "not-allowed"
          ? "Microphone access was blocked. You can type instead."
          : "Could not hear anything. Please try again, or type instead.",
      );
      setListening(false);
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  // No browser support: say so plainly and let them type. Never a dead button.
  if (!supported) {
    return (
      <p className="text-sm text-ink-300">
        Voice input is not available in this browser — please type instead.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        className={`inline-flex min-h-touch items-center gap-2 rounded-button border px-4 text-base font-medium transition-colors ${
          listening
            ? "border-accent bg-accent-subtle text-accent"
            : "border-border bg-surface text-ink-900 hover:bg-accent-subtle"
        }`}
      >
        {listening ? (
          <Square size={20} strokeWidth={1.5} aria-hidden />
        ) : (
          <Mic size={20} strokeWidth={1.5} aria-hidden />
        )}
        {listening ? "Stop recording" : "Speak instead of typing"}
      </button>

      {/* §9 — a clear recording state, announced rather than colour-only. */}
      {listening && (
        <p className="mt-2 flex items-center gap-2 text-sm text-accent" role="status">
          <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden />
          Listening — speak now. Your words will appear in the box above.
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
