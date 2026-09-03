import Link from "next/link";
import { getSessionUserForChrome } from "@/lib/auth";
import { SignOutButton } from "@/components/ui/SignOutButton";

/**
 * A single thin header across every page.
 *
 * Deliberately minimal — DESIGN.md's whole posture is restraint, and the
 * citizen flow in §8 wants one obvious action per screen, not a navigation
 * bar competing with it. This exists for two things that were genuinely
 * missing: a way back to the start, and a way to sign out.
 */

const DASHBOARD_FOR: Record<string, { href: string; label: string }> = {
  admin: { href: "/admin", label: "Dashboard" },
  university: { href: "/university", label: "My institution" },
  industry: { href: "/industry", label: "Projects" },
};

export async function SiteHeader() {
  // Chrome must never 500 a page over auth — see getSessionUserForChrome.
  const user = await getSessionUserForChrome();
  const dashboard = user ? DASHBOARD_FOR[user.role] : undefined;

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="text-sm font-medium tracking-wide text-accent uppercase">
          JanSetu
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          <Link href="/" className="text-ink-600 transition-colors hover:text-accent">
            Report
          </Link>
          <Link href="/feed" className="text-ink-600 transition-colors hover:text-accent">
            Feed
          </Link>
          {dashboard && (
            <Link href={dashboard.href} className="text-ink-600 transition-colors hover:text-accent">
              {dashboard.label}
            </Link>
          )}
          {user ? (
            <SignOutButton />
          ) : (
            <Link href="/login" className="text-ink-600 transition-colors hover:text-accent">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
