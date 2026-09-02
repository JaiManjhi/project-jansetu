"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";

/**
 * Voice input via the browser-native Web Speech API — ARCHITECTURE.md §3.
 * Zero backend, zero API key, so it ships first. Whisper-on-Groq is the
 * upgrade path if there is slack, not a prerequisite.
 *
 * PRD §6 acceptance: the transcription is visible and EDITABLE before submit.
 * That is the whole point — recognition on Indian-accented Hindi and English
 * is imperfect, and a citizen must be able to correct it rather than submit
 * whatever the browser guessed.
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
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
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

/**
 * The API silently refuses to work outside a secure context, which is easy to
 * hit by opening the dev server on a LAN IP to test on a phone. Detected
 * explicitly so the citizen gets a reason instead of a dead button.
 */
function isSecureContextForSpeech(): boolean {
  if (typeof window === "undefined") return true;
  return window.isSecureContext === true;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser settings, or type instead.",
  "service-not-allowed": "Your browser blocked speech recognition. Please type instead.",
  "audio-capture": "No microphone was found. Please type instead.",
  network: "Speech recognition needs a connection and could not reach the service. Please type instead.",
  aborted: "Recording stopped.",
  "no-speech": "Nothing was heard. Move closer to the microphone and try again, or type instead.",
};

interface VoiceInputProps {
  language: string;
  /** Appends recognised text to whatever the citizen has already typed. */
  onTranscript: (text: string) => void;
}

export function VoiceInput({ language, onTranscript }: VoiceInputProps) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Whether this session produced any final text. Used to explain a session
  // that ended having heard nothing, instead of just going quiet.
  const heardSomethingRef = useRef(false);

  // Held in a ref so the recognition callbacks always call the CURRENT prop.
  // The handlers are attached once per session and would otherwise keep the
  // closure from the render that started it.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const supported = useSyncExternalStore(
    () => () => {},
    () => getRecognitionCtor() !== null,
    () => false,
  );
  const secure = useSyncExternalStore(
    () => () => {},
    () => isSecureContextForSpeech(),
    () => true,
  );

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    setError(null);
    setInterim("");
    heardSomethingRef.current = false;

    const recognition = new Ctor();
    recognition.lang = language === "hi" ? "hi-IN" : "en-IN";
    recognition.continuous = true;
    /**
     * Interim results ON — this is the fix for "I spoke and nothing happened".
     *
     * With them off, the citizen sees a blank box for the several seconds
     * before a final result arrives, and sees nothing at all if the session
     * ends on silence first. Partial text appearing as they speak is the only
     * signal that the microphone is actually working. Interim text is shown
     * separately and only committed to the textarea when it is final, so the
     * citizen never has to delete half-recognised words.
     */
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) finalText += result[0].transcript;
        else partial += result[0].transcript;
      }

      if (finalText.trim()) {
        heardSomethingRef.current = true;
        onTranscriptRef.current(finalText.trim());
        setInterim("");
      } else {
        setInterim(partial);
      }
    };

    recognition.onerror = (event) => {
      // "aborted" is what a deliberate stop() produces; it is not a failure.
      if (event.error === "aborted") return;
      setError(
        ERROR_MESSAGES[event.error] ??
          "Speech recognition stopped unexpectedly. You can type instead.",
      );
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
      // Chrome ends a session on its own after a stretch of silence. Saying so
      // is the difference between "it is broken" and "it stopped listening".
      if (!heardSomethingRef.current) {
        setError((current) =>
          current ?? "Stopped listening — nothing was recognised. Try again, or type instead.",
        );
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      // Some browsers never fire onstart; do not leave the button inert.
      setListening(true);
    } catch {
      setError("Could not start the microphone. Please type instead.");
      setListening(false);
    }
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
  }

  if (!supported) {
    return (
      <p className="text-sm text-ink-300">
        Voice input is not available in this browser — please type instead.
      </p>
    );
  }

  if (!secure) {
    // Worth naming precisely: this bites when testing on a phone over a LAN IP,
    // and the symptom is otherwise a button that does nothing.
    return (
      <p className="text-sm text-warning">
        Voice input needs a secure (https) connection, so it is unavailable
        here. Please type instead.
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

      {listening && (
        <p className="mt-2 flex items-start gap-2 text-sm text-accent" role="status">
          <span className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
          <span>
            {interim
              ? // Live partial text: proof the microphone is working.
                interim
              : "Listening — start speaking. Your words will appear here, then move into the box above."}
          </span>
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm text-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
