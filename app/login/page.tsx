"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Credential sign-in for university, industry and admin.
 *
 * Citizens are deliberately absent: submission is never gated behind a login
 * (ARCHITECTURE.md §7), and offering them a form they cannot use would imply
 * otherwise.
 */

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });

    if (!result || result.error) {
      // Deliberately does not say which of the two was wrong — that difference
      // tells an attacker which accounts exist.
      setError("That email and password did not match an account.");
      setSubmitting(false);
      return;
    }

    router.push(params.get("callbackUrl") ?? "/admin");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6" noValidate>
      <div>
        <label htmlFor="email" className="block text-base font-medium text-ink-900">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mt-2 min-h-touch w-full rounded-button border border-border bg-surface px-3 text-base text-ink-900"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-base font-medium text-ink-900">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mt-2 min-h-touch w-full rounded-button border border-border bg-surface px-3 text-base text-ink-900"
        />
      </div>

      {error && (
        <p className="rounded-button border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting && <LoaderCircle size={20} strokeWidth={1.5} className="animate-spin" aria-hidden />}
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-12 sm:px-6">
      <p className="text-sm font-medium tracking-wide text-accent uppercase">JanSetu</p>
      <h1 className="font-display mt-2 text-2xl text-ink-900">Sign in</h1>
      <p className="mt-3 text-base text-ink-600">
        For university coordinators, industry partners and administrators.
        Reporting a problem does not need an account.
      </p>

      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={<p className="mt-8 text-sm text-ink-300">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
