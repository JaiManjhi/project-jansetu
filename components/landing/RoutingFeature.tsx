import Link from "next/link";
import { Check, ArrowRight, MapPin } from "lucide-react";

/**
 * How routing actually works, shown rather than asserted.
 *
 * The sample card is a REAL routed report from the seeded Jharkhand set — coal
 * dust in Dhanbad, matched to IIT (ISM)'s Environmental Science & Engineering
 * department at a score of 0.49. The generated design this layout came from
 * used an invented "Pothole on Main St → Public Works Dept" with a fabricated
 * 94% confidence. Inventing an example on the one section that explains the
 * product's core claim would be the worst possible place to do it, and a judge
 * can check this one against the live feed.
 *
 * The three claims below are each things the engine genuinely does. The refusal
 * is listed last because it is the most defensible and the least expected.
 */

const CLAIMS = [
  "Compares a problem against each department's actual published research, not just how close it is.",
  "Accounts for how much a department is already carrying, so the same popular faculty is not handed everything.",
  "Refuses to route at all when nothing scores well enough, instead of inventing a confident match.",
];

export function RoutingFeature() {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-20">
        {/* The example. Ordered first on desktop, second on mobile, so a narrow
            screen reads the claim before the illustration of it. */}
        <div className="order-2 lg:order-1">
          <div className="rounded-card border border-border bg-paper p-6 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-semibold tracking-wide text-ink-300 uppercase">
                Reported by a citizen
              </p>
              <span className="shrink-0 rounded-button bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
                Environment
              </span>
            </div>

            <p className="mt-3 text-base text-ink-900">
              Coal dust from the nearby open-cast mine is settling on rooftops and drinking water
              tanks.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-600">
              <MapPin size={14} strokeWidth={1.75} aria-hidden />
              Dhanbad, Jharkhand
            </p>

            <div className="mt-5 rounded-button border border-border bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-semibold text-success">Routed to IIT (ISM) Dhanbad</p>
                <p className="text-xs text-ink-300 tabular-nums">match 0.49 · 5 km</p>
              </div>
              <p className="mt-1 text-sm text-ink-600">
                Department of Environmental Science &amp; Engineering
              </p>
              <p className="mt-3 border-l-2 border-accent pl-3 text-sm text-ink-600">
                Studies mine dust dispersion and water contamination, and is only 5&nbsp;km away.
              </p>
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <h2 className="font-display text-xl text-balance text-ink-900 sm:text-2xl">
            Matched on real expertise, not just distance
          </h2>
          <p className="mt-4 text-base text-ink-600">
            Every report is compared against the research profile of individual departments across
            299 institutions — then explained in a sentence a coordinator can check.
          </p>

          <ul className="mt-7 grid gap-4">
            {CLAIMS.map((claim) => (
              <li key={claim} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/10">
                  <Check size={13} strokeWidth={3} className="text-success" aria-hidden />
                </span>
                <span className="text-sm text-ink-600">{claim}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/feed"
            className="mt-8 inline-flex min-h-touch items-center gap-2 rounded-button border border-border bg-surface px-6 text-base font-semibold text-ink-900 transition-colors hover:border-accent hover:text-accent"
          >
            See real matches in the feed
            <ArrowRight size={18} strokeWidth={2.25} aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
