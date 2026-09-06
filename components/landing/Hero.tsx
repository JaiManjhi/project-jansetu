import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowDown, MicOff, WifiOff, Languages, TrendingUp } from "lucide-react";

/**
 * Landing hero — DESIGN.md §1, rebuilt after the 2026-09-07 direction change.
 *
 * The previous version stacked a headline, a paragraph and an image down a
 * narrow column, leaving roughly 40% of the viewport empty beside it and
 * pushing the one photograph below the fold. It was flat rather than restrained.
 *
 * This is a split composition: the argument on the left, the place it is about
 * on the right, both above the fold. The image carries a floating figure card
 * because a number sitting on a photograph is read, and the same number in a
 * paragraph is skipped.
 */

interface HeroProps {
  problemCount: number;
  districtCount: number;
  institutionCount: number;
  stateCount: number;
}

const TRUST = [
  { icon: MicOff, label: "No login needed" },
  { icon: WifiOff, label: "Works offline" },
  { icon: Languages, label: "5 languages" },
];

export function Hero({ institutionCount }: HeroProps) {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-24">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-accent-subtle px-3 py-1.5 text-xs font-semibold tracking-wide text-accent uppercase">
            SIH26043 · Smart India Hackathon
          </p>

          <h1 className="font-display mt-6 text-2xl leading-tight text-balance text-ink-900 sm:text-3xl">
            Tell us what is broken near you.
          </h1>

          <p className="mt-5 max-w-xl text-base text-ink-600">
            Describe it in your own words — type or speak. We check whether your neighbours already
            reported it, then send it to the university department best equipped to fix it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#report"
              className="inline-flex min-h-touch items-center gap-2 rounded-button bg-accent px-6 text-base font-semibold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-accent-deep"
            >
              Report a problem
              <ArrowDown size={18} strokeWidth={2.25} aria-hidden />
            </a>
            <Link
              href="/feed"
              className="inline-flex min-h-touch items-center gap-2 rounded-button border border-border bg-surface px-6 text-base font-semibold text-ink-900 transition-colors hover:border-accent hover:text-accent"
            >
              Browse reports
              <ArrowRight size={18} strokeWidth={2.25} aria-hidden />
            </Link>
          </div>

          <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-6">
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-sm text-ink-600">
                <Icon size={16} strokeWidth={1.75} className="text-accent" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>

        {/*
          The photograph and the figure over it. Ordered second in the DOM so a
          screen reader and a narrow screen both reach the headline and the
          report button before the decoration.
        */}
        <div className="relative">
          <div className="overflow-hidden rounded-card border border-border shadow-[var(--shadow-float)]">
            <Image
              src="/hero-bridge.jpg"
              alt="A rural road bridge crossing a river in Jharkhand, with hills and a village behind it."
              width={1376}
              height={768}
              sizes="(max-width: 1024px) 100vw, 560px"
              className="h-full w-full object-cover"
              priority
            />
          </div>

          <div className="absolute -bottom-5 left-5 flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-[var(--shadow-float)]">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-button bg-success/10">
              <TrendingUp size={18} strokeWidth={2} className="text-success" aria-hidden />
            </span>
            <span>
              <span className="block text-base font-semibold text-ink-900 tabular-nums">
                {institutionCount} institutions
              </span>
              <span className="block text-xs text-ink-600">ready to take work on</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
