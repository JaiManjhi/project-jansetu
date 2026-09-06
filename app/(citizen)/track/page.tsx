import { redirect } from "next/navigation";
import { isValidObjectId } from "mongoose";
import Link from "next/link";

/**
 * Look up a report by its reference.
 *
 * There are no accounts, so there is no "my reports" list to fall back on — the
 * reference is the only handle a citizen has. This page exists so that handle
 * is usable by someone who wrote the number down rather than keeping the tab
 * open, which is the realistic case for the phone this is used on.
 *
 * A plain form with a server action: no client JavaScript, so it still works on
 * a slow connection where the bundle has not arrived, and the browser's own
 * validation does the empty-field case for free.
 */

async function lookup(formData: FormData) {
  "use server";

  const raw = formData.get("reference");
  const reference = typeof raw === "string" ? raw.trim() : "";

  // A pasted URL is the likeliest thing someone has to hand, so take the id off
  // the end of one rather than rejecting it.
  const id = reference.split("/").filter(Boolean).pop() ?? "";

  if (!isValidObjectId(id)) {
    redirect("/track?error=invalid");
  }
  redirect(`/track/${id}`);
}

export default async function TrackLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-sm font-medium tracking-wide text-accent uppercase">JanSetu</p>
      <h1 className="font-display mt-2 text-2xl text-ink-900">Follow a report</h1>
      <p className="mt-3 text-base text-ink-600">
        Paste the reference you were given when you reported a problem, or the link to it, and
        you will see exactly where it has reached.
      </p>

      <form action={lookup} className="mt-8">
        <label htmlFor="reference" className="block text-base font-medium text-ink-900">
          Report reference
        </label>
        <p id="reference-help" className="mt-1 text-sm text-ink-600">
          The long code shown after you submitted, or the whole link.
        </p>
        <input
          id="reference"
          name="reference"
          required
          autoComplete="off"
          spellCheck={false}
          aria-describedby="reference-help"
          placeholder="6a99bbd1d9abd23c113150a3"
          className="mt-3 min-h-touch w-full rounded-button border border-border bg-surface px-3 font-mono text-base text-ink-900 placeholder:text-ink-300"
        />

        {error === "invalid" && (
          <p className="mt-3 text-sm text-warning" role="alert">
            That does not look like a report reference. It is a 24-character code of letters and
            numbers — check for a missing character.
          </p>
        )}

        <button
          type="submit"
          className="mt-5 inline-flex min-h-touch items-center rounded-button bg-accent px-6 text-base font-medium text-white transition-colors hover:bg-accent-deep"
        >
          Find my report
        </button>
      </form>

      <p className="mt-10 border-t border-border pt-6 text-sm text-ink-600">
        Lost the reference?{" "}
        <Link href="/feed" className="text-accent underline underline-offset-2">
          Search the public feed
        </Link>{" "}
        — every report appears there, and you can find yours by its district and description.
      </p>
    </main>
  );
}
