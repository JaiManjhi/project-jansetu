import { NextResponse } from "next/server";
import {
  GROQ_TRANSCRIBE_URL,
  GROQ_WHISPER_MODEL,
  TIMEOUTS,
  WHISPER_LANGUAGE_HINTS,
  requireEnv,
} from "@/lib/ai/models";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { VOICE_LANGUAGE_ENUM } from "@/lib/constants";

/**
 * POST /api/transcribe — public. API_SPEC.md.
 *
 * Speech to text for the citizen report form. Accepts a recorded audio clip as
 * multipart/form-data and returns the transcript for the citizen to edit.
 *
 * Why this exists at all: the browser-native Web Speech API was the original
 * implementation (ARCHITECTURE.md §3) because it needs no backend and no key.
 * It does not survive contact with the phones this app is for — Android Chrome
 * mishandles continuous recognition and iOS requires Siri dictation to be
 * enabled — so a citizen would tap the microphone, speak, and watch nothing
 * appear. Recording locally and transcribing server-side behaves the same on
 * every device.
 */

/** Whisper is not fast on a long clip over a slow uplink. */
export const maxDuration = 60;

/**
 * The clip ceiling. MAX_RECORDING_MS in VoiceInput stops recording at 60s, so
 * this is the ceiling for a *well-behaved* client; it exists to bound what a
 * crafted request can spend, not to catch normal use. Roughly 60s of Opus at
 * the bitrates browsers choose, with generous headroom.
 */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/**
 * Formats Groq accepts, intersected with what browsers actually produce:
 * Android Chrome records audio/webm (Opus), iOS Safari records audio/mp4 (AAC).
 * The browser appends its own codec parameters, so match on the prefix.
 */
const ALLOWED_AUDIO_PREFIXES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpga",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
];

/**
 * The languages the report form offers, and the only ones passed upstream as a
 * hint. Every code was verified against the live Whisper endpoint — Odia is
 * absent because Groq rejects `language=or` outright, which is also why it is a
 * reading language only. See lib/constants.ts.
 */
const ALLOWED_LANGUAGES = new Set<string>(VOICE_LANGUAGE_ENUM);

/**
 * Transcription costs Groq quota per call on an unauthenticated route, exactly
 * like submission does. 40/hour is far more than a citizen filing one report
 * needs — a few retries plus a re-record — and far less than a script can use
 * to drain the account before a demo.
 */
const TRANSCRIBE_LIMIT = 40;
const TRANSCRIBE_WINDOW_MS = 60 * 60 * 1000;

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const limit = rateLimit(`transcribe:${clientIp(request)}`, TRANSCRIBE_LIMIT, TRANSCRIBE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many voice requests from this device. Please type instead.", code: "RATE_LIMITED" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Expected multipart/form-data with an audio file.", "INVALID_BODY", 400);
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return errorResponse("No audio file was included.", "VALIDATION_FAILED", 400);
  }
  if (audio.size === 0) {
    return errorResponse("The recording was empty.", "EMPTY_AUDIO", 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return errorResponse("That recording is too long. Keep it under a minute.", "AUDIO_TOO_LARGE", 413);
  }

  // Split on ";" first: browsers send e.g. audio/webm;codecs=opus.
  const mime = (audio.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_AUDIO_PREFIXES.includes(mime)) {
    return errorResponse("That audio format is not supported.", "UNSUPPORTED_AUDIO", 415);
  }

  const languageRaw = form.get("language");
  const language = typeof languageRaw === "string" && ALLOWED_LANGUAGES.has(languageRaw)
    ? languageRaw
    : undefined;

  const upstream = new FormData();
  upstream.set("file", audio, audio.name || "recording");
  upstream.set("model", GROQ_WHISPER_MODEL);
  upstream.set("response_format", "json");
  // Telling Whisper the language is worth more accuracy than it looks, and it
  // stops a Hindi clip being "transcribed" as phonetic English.
  if (language) upstream.set("language", language);

  /**
   * Greedy decoding. Groq documents 0 as the recommended default, and for a
   * transcription that a citizen will read back and correct, a reproducible
   * answer is worth more than a fluent-sounding one.
   */
  upstream.set("temperature", "0");

  /**
   * A vocabulary hint in the target language. Whisper biases toward text that
   * resembles its prompt, which is what pulls domain words — hand pump, drain,
   * block office — back from the nearest common word in a low-resource
   * language. Only set for languages that have one; English does not.
   */
  const hint = language ? WHISPER_LANGUAGE_HINTS[language] : undefined;
  if (hint) upstream.set("prompt", hint);

  let response: Response;
  try {
    response = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireEnv("GROQ_API_KEY")}` },
      body: upstream,
      signal: AbortSignal.timeout(TIMEOUTS.transcribeMs),
    });
  } catch (error: unknown) {
    console.error(`[transcribe] request failed: ${error instanceof Error ? error.message : error}`);
    return errorResponse(
      "Could not reach the transcription service. Please type instead.",
      "TRANSCRIPTION_UNAVAILABLE",
      503,
    );
  }

  if (!response.ok) {
    // The upstream body can carry the API key back in an error envelope, so log
    // the status and a bounded snippet only.
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    console.error(`[transcribe] groq ${response.status}: ${detail}`);
    if (response.status === 429) {
      return errorResponse(
        "Voice input is busy right now. Please try again, or type instead.",
        "TRANSCRIPTION_RATE_LIMITED",
        503,
      );
    }
    return errorResponse(
      "Could not transcribe that recording. Please type instead.",
      "TRANSCRIPTION_FAILED",
      503,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string") {
    console.error("[transcribe] groq returned no text field");
    return errorResponse(
      "Could not transcribe that recording. Please type instead.",
      "TRANSCRIPTION_FAILED",
      503,
    );
  }

  return NextResponse.json({ text: text.trim() });
}
