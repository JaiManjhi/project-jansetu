import Link from "next/link";
import Image from "next/image";

/**
 * Site footer — dark navy, per the 2026-09-07 direction change.
 *
 * A solid ground does real work here beyond looking finished: it closes the
 * page. The previous white footer ran into the white section above it, so the
 * page appeared to stop rather than end.
 *
 * GIGW 3.0 asks a government service to state its ownership, its accessibility
 * position and how to reach it. Most of what belongs in a real government
 * footer does not exist yet — no grievance officer, no RTI page, no privacy
 * policy — and linking to pages that are not there would be worse than saying
 * so. The generated design this layout came from offered Privacy and Terms
 * links; both would have 404'd.
 */

const EXPLORE = [
  { href: "/", label: "Report a problem" },
  { href: "/feed", label: "What people are reporting" },
  { href: "/track", label: "Follow a report" },
  { href: "/login", label: "Institution & partner sign in" },
];

export function SiteFooter() {
  return (
    <footer className="bg-accent-deep">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              {/* The emblem sits on a white tile here — the mark carries white
                  bridge cables that would disappear against the navy ground. */}
              <span className="flex size-9 items-center justify-center rounded-button bg-white">
                <Image src="/logo.png" alt="" width={28} height={28} />
              </span>
              <p className="font-display text-lg leading-none text-white">JanSetu</p>
            </div>
            <p className="mt-4 max-w-xs text-sm text-white/70">
              Citizens report local problems. Universities with the right expertise take them on.
              Industry backs the work.
            </p>
          </div>

          <div>
            <h2 className="text-xs font-semibold tracking-wide text-white/50 uppercase">Explore</h2>
            <ul className="mt-4 grid gap-3 text-sm">
              {EXPLORE.map((item) => (
                <li key={item.href + item.label}>
                  <Link
                    href={item.href}
                    className="text-white/80 transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-semibold tracking-wide text-white/50 uppercase">
              Accessibility
            </h2>
            <p className="mt-4 text-sm text-white/70">
              Built to WCAG 2.1 Level AA colour contrast, keyboard navigable, and readable in
              English, हिंदी, বাংলা, मराठी and ଓଡ଼ିଆ.
            </p>
          </div>
        </div>

        <div className="mt-12 border-t border-white/15 pt-6">
          <p className="text-sm text-white/70">
            A Government of Jharkhand initiative, built for Smart India Hackathon problem statement
            SIH26043.
          </p>
          <p className="mt-2 text-sm text-white/45">
            Prototype. Pledges recorded here are statements of intent — no money is taken or
            transferred through this platform.
          </p>
        </div>
      </div>
    </footer>
  );
}
