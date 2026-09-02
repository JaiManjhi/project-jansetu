"use client";

import { useRef, useState } from "react";
import { Camera, X, LoaderCircle } from "lucide-react";

/**
 * Photo attachment for a report.
 *
 * Uploads straight to Cloudinary using a signature from /api/media/sign, so
 * the file bytes never traverse our own server. Photos are strictly optional:
 * every failure path here leaves the citizen able to submit without one,
 * because a broken upload must never block a report.
 */

const MAX_PHOTOS = 3;
const MAX_BYTES = 10 * 1024 * 1024;

interface SignResponse {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
}

export function PhotoUpload({
  urls,
  onChange,
  disabled,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const room = MAX_PHOTOS - urls.length;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }

    const chosen = Array.from(files).slice(0, room);
    const tooBig = chosen.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(`"${tooBig.name}" is larger than 10MB. Please choose a smaller photo.`);
      return;
    }

    setUploading(true);
    try {
      const signResponse = await fetch("/api/media/sign", { method: "POST" });
      if (!signResponse.ok) {
        setError(
          signResponse.status === 503
            ? "Photo upload is not available right now. You can still submit without a photo."
            : "Could not start the upload. You can still submit without a photo.",
        );
        return;
      }
      const sign = (await signResponse.json()) as SignResponse;

      const uploaded: string[] = [];
      for (const file of chosen) {
        const form = new FormData();
        form.append("file", file);
        form.append("api_key", sign.apiKey);
        form.append("timestamp", String(sign.timestamp));
        form.append("folder", sign.folder);
        form.append("signature", sign.signature);

        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`,
          { method: "POST", body: form },
        );
        if (!response.ok) {
          setError("A photo failed to upload. You can still submit without it.");
          break;
        }
        const body = (await response.json()) as { secure_url?: unknown };
        if (typeof body.secure_url === "string") uploaded.push(body.secure_url);
      }

      if (uploaded.length > 0) onChange([...urls, ...uploaded]);
    } catch {
      setError("Could not upload — you may be offline. You can still submit without a photo.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        id="photos"
        type="file"
        accept="image/*"
        // On a phone this offers the camera directly, which is the common case
        // for someone standing in front of the problem.
        capture="environment"
        multiple
        className="sr-only"
        disabled={disabled || uploading}
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading || urls.length >= MAX_PHOTOS}
        className="inline-flex min-h-touch items-center gap-2 rounded-button border border-border bg-surface px-4 text-base font-medium text-ink-900 transition-colors hover:bg-accent-subtle disabled:text-ink-300"
      >
        {uploading ? (
          <LoaderCircle size={20} strokeWidth={1.5} className="animate-spin" aria-hidden />
        ) : (
          <Camera size={20} strokeWidth={1.5} aria-hidden />
        )}
        {uploading ? "Uploading…" : urls.length > 0 ? "Add another photo" : "Add a photo"}
      </button>

      {urls.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {urls.map((url) => (
            <li key={url} className="relative">
              {/* Plain <img>: these are arbitrary Cloudinary URLs and running
                  them through next/image would need remote-pattern config for
                  no benefit at thumbnail size. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="Attached photo of the reported problem"
                className="size-20 rounded-button border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(urls.filter((u) => u !== url))}
                aria-label="Remove this photo"
                className="absolute -top-2 -right-2 rounded-full border border-border bg-surface p-1 text-ink-600 transition-colors hover:text-danger"
              >
                <X size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-2 text-sm text-warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
