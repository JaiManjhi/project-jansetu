"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square, LoaderCircle } from "lucide-react";

/**
 * Voice input for the citizen report form.
 *
 * PRD §6 acceptance: the transcription is visible and EDITABLE before submit.
 * That is the whole point — recognition on Indian-accented Hindi and English is
 * imperfect, and a citizen must be able to correct it rather than submit
 * whatever the machine guessed.
 *
 * ## Why this records instead of using the browser's recogniser
 *
 * The first implementation used the Web Speech API, per ARCHITECTURE.md §3:
 * zero backend, zero key, so it shipped first. It works on desktop Chrome and
 * fails on the devices this app exists for. Android Chrome does not honour
 * `continuous` and ends the session before a sentence completes; iOS Safari
 * silently produces nothing unless Siri dictation is enabled. The symptom in
 * both cases is the one that matters: the microphone light comes on, the
 * citizen speaks, and not a single word appears.
 *
 * Recording locally with MediaRecorder and transcribing on the server behaves
 * identically on every device, which is worth more here than the round trip
 * costs. ARCHITECTURE.md §3 always named Whisper-on-Groq as the upgrade path;
 * this is that path, promoted to primary.
 */

/** Hard stop. Whisper is billed by audio length and a phone left recording is a bill. */
const MAX_RECORDING_MS = 60_000;

/** Below this the clip is a stray tap, not speech — Whisper would hallucinate on it. */
const MIN_AUDIO_BYTES = 1_200;

/**
 * Preference order for the recording container. Android Chrome supports webm
 * with Opus; iOS Safari supports neither and produces mp4/AAC. An empty string
 * lets MediaRecorder pick its own default, which is what older browsers need.
 */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", ""];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of MIME_CANDIDATES) {
    if (candidate === "") return "";
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function isRecordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * getUserMedia is unavailable outside a secure context, which is easy to hit by
 * opening the dev server on a LAN IP to test on a phone. Detected explicitly so
 * the citizen gets a reason instead of a dead button.
 */
function isSecureContextForRecording(): boolean {
  if (typeof window === "undefined") return true;
  return window.isSecureContext === true;
}

function permissionMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it in your browser settings, or type instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Please type instead.";
  }
  if (name === "NotReadableError") {
    return "The microphone is being used by another app. Close it and try again, or type instead.";
  }
  return "Could not start the microphone. Please type instead.";
}

interface VoiceInputProps {
  language: string;
  /** Appends recognised text to whatever the citizen has already typed. */
  onTranscript: (text: string) => void;
}

type Phase = "idle" | "recording" | "transcribing";

export function VoiceInput({ language, onTranscript }: VoiceInputProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Held in refs so the recorder callbacks always see the CURRENT props. The
  // handlers are attached once per recording and would otherwise capture the
  // closure from the render that started it.
  const onTranscriptRef = useRef(onTranscript);
  const languageRef = useRef(language);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    languageRef.current = language;
  }, [onTranscript, language]);

  const supported = useSyncExternalStore(
    () => () => {},
    () => isRecordingSupported(),
    () => true,
  );
  const secure = useSyncExternalStore(
    () => () => {},
    () => isSecureContextForRecording(),
    () => true,
  );

  /** Releases the mic and every timer. Safe to call twice. */
  function cleanup() {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    // Without this the browser keeps showing its "recording" indicator, which
    // reads as the app still listening after the citizen stopped it.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  useEffect(() => cleanup, []);

  async function transcribe(blob: Blob) {
    if (blob.size < MIN_AUDIO_BYTES) {
      setPhase("idle");
      setError("Nothing was recorded. Tap the button, speak, then tap it again — or type instead.");
      return;
    }

    setPhase("transcribing");
    try {
      const form = new FormData();
      // The extension has to match the container or the upload is rejected.
      const extension = blob.type.includes("mp4")
        ? "mp4"
        : blob.type.includes("mpeg")
          ? "mp3"
          : "webm";
      form.append("audio", blob, `recording.${extension}`);
      form.append("language", languageRef.current);

      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message = (body as { error?: unknown } | null)?.error;
        setError(
          typeof message === "string"
            ? message
            : "Could not transcribe that recording. Please type instead.",
        );
        return;
      }

      const text = (body as { text?: unknown } | null)?.text;
      if (typeof text !== "string" || text.trim() === "") {
        setError("Nothing was recognised. Try speaking closer to the microphone, or type instead.");
        return;
      }
      onTranscriptRef.current(text.trim());
    } catch {
      setError("Could not reach the transcription service. Please type instead.");
    } finally {
      setPhase("idle");
    }
  }

  async function start() {
    setError(null);
    chunksRef.current = [];
    setSeconds(0);

    let stream: MediaStream;
    try {
      /**
       * Capture shaped for speech recognition rather than for music.
       *
       * Groq downsamples everything to 16 kHz mono before transcribing, so
       * recording at 48 kHz stereo uploads several times the bytes to reach the
       * same result — and this app is used on rural connections where that is
       * the difference between a report sending and a report failing. Asking
       * for 16 kHz mono up front makes the clip small and skips a resample.
       *
       * The three processing flags matter more than they look for the actual
       * recording conditions here: someone standing beside a road, holding a
       * cheap phone at arm's length. Gain control rescues a quiet speaker,
       * noise suppression takes out traffic. All four are hints — a browser is
       * free to ignore any of them, which is why nothing downstream assumes a
       * particular rate.
       */
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16_000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error: unknown) {
      setError(permissionMessage(error));
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      const mimeType = pickMimeType();
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        /**
         * Opus at 48 kbps is generous for 16 kHz mono speech — well above the
         * point where compression starts eating consonants, which is exactly
         * what a transcriber mishears. A full 60-second clip is still only
         * about 360 KB.
         */
        audioBitsPerSecond: 48_000,
      });
    } catch {
      cleanup();
      setError("This browser cannot record audio. Please type instead.");
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      // The recorder's own type is authoritative about what it produced.
      const type = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      cleanup();
      void transcribe(blob);
    };

    recorder.onerror = () => {
      cleanup();
      setPhase("idle");
      setError("Recording stopped unexpectedly. Please try again, or type instead.");
    };

    // A timeslice makes the recorder flush chunks as it goes, so a tab suspended
    // mid-recording still yields whatever was captured before it froze.
    recorder.start(1_000);
    setPhase("recording");

    tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1_000);
    stopTimerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, MAX_RECORDING_MS);
  }

  function stop() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else {
      cleanup();
      setPhase("idle");
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-ink-300">
        Voice input is not available in this browser — please type instead.
      </p>
    );
  }

  if (!secure) {
    return (
      <p className="text-sm text-warning">
        Voice input needs a secure (https) connection, so it is unavailable here. Please type
        instead.
      </p>
    );
  }

  const busy = phase === "transcribing";
  const recording = phase === "recording";

  return (
    <div>
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={busy}
        aria-pressed={recording}
        className={`inline-flex min-h-touch items-center gap-2 rounded-button border px-4 text-base font-medium transition-colors disabled:text-ink-300 ${
          recording
            ? "border-accent bg-accent-subtle text-accent"
            : "border-border bg-surface text-ink-900 hover:bg-accent-subtle"
        }`}
      >
        {busy ? (
          <LoaderCircle size={20} strokeWidth={1.5} className="animate-spin" aria-hidden />
        ) : recording ? (
          <Square size={20} strokeWidth={1.5} aria-hidden />
        ) : (
          <Mic size={20} strokeWidth={1.5} aria-hidden />
        )}
        {busy ? "Writing it down…" : recording ? "Stop and use this" : "Speak instead of typing"}
      </button>

      {recording && (
        <p className="mt-2 flex items-start gap-2 text-sm text-accent" role="status">
          <span className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
          <span>
            Recording {seconds}s — speak now, then tap Stop. Your words appear in the box above.
          </span>
        </p>
      )}

      {busy && (
        <p className="mt-2 text-sm text-ink-600" role="status">
          Turning your recording into text…
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
