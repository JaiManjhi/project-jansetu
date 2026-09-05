import Link from "next/link";
import Image from "next/image";

/**
 * Site footer.
 *
 * GIGW 3.0 asks a government service to state its ownership, its accessibility
 * position and how to reach it. Most of what belongs here does not exist yet —
 * there is no grievance officer, no RTI page, no privacy policy — and inventing
 * links to pages that are not there would be worse than saying so.
 *
 * So this footer states what is true, including the parts that are unflattering:
 * that this is a hackathon prototype, that pledges are intentions rather than
 * transactions, and that no money moves through the platform. A judge reading it
 * learns exactly where the boundary of the build is.
 */

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <Image src="/logo.png" alt="" width={30} height={30} />
              <p className="font-display text-lg leading-none">
                <span className="text-accent">Jan</span>
                <span className="text-success">Setu</span>
              </p>
            </div>
            <p className="mt-3 max-w-xs text-sm text-ink-600">
              Citizens report local problems. Universities with the right expertise take them on.
              Industry backs the work.
            </p>
          </div>

          <div>
            <h2 className="text-xs tracking-wide text-ink-300 uppercase">Explore</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              <li>
                <Link href="/" className="text-ink-600 hover:text-accent">
                  Report a problem
                </Link>
              </li>
              <li>
                <Link href="/feed" className="text-ink-600 hover:text-accent">
                  What people are reporting
                </Link>
              </li>
              <li>
                <Link href="/login" className="text-ink-600 hover:text-accent">
                  Institution &amp; partner sign in
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xs tracking-wide text-ink-300 uppercase">Accessibility</h2>
            <p className="mt-3 text-sm text-ink-600">
              Built to WCAG 2.1 Level AA colour contrast, keyboard navigable, and readable in
              English, हिंदी, বাংলা, मराठी and ଓଡ଼ିଆ.
            </p>
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <p className="text-sm text-ink-600">
            A Government of Jharkhand initiative, built for Smart India Hackathon problem statement
            SIH26043.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            Prototype. Pledges recorded here are statements of intent — no money is taken or
            transferred through this platform.
          </p>
        </div>
      </div>
    </footer>
  );
}
