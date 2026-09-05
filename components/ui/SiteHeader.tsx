import Link from "next/link";
import Image from "next/image";
import { getSessionUserForChrome } from "@/lib/auth";
import { SignOutButton } from "@/components/ui/SignOutButton";

/**
 * The header on every page — DESIGN.md's posture of restraint.
 *
 * Two bars. The thin top one carries the ownership line, which GIGW 3.0 requires
 * a government service to make identifiable on its homepage and every important
 * entry page; putting it only in the footer satisfies the letter of that and not
 * the point of it. The main bar carries the mark and the few links that exist.
 *
 * The wordmark is set in type rather than shipped as an image: it splits
 * navy/green exactly as the logo does, stays crisp at any size, and costs no
 * extra request on a rural connection.
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
      <div className="border-b border-border bg-accent">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-1.5 sm:px-6">
          <p className="text-xs text-white/90">
            A Government of Jharkhand initiative · Smart India Hackathon SIH26043
          </p>
          <p className="hidden text-xs text-white/70 sm:block">भारत सरकार · Government of India</p>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/icon-192.png" alt="" width={32} height={32} className="rounded-md" />
          <span className="font-display text-lg leading-none">
            <span className="text-accent">Jan</span>
            <span className="text-success">Setu</span>
          </span>
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
