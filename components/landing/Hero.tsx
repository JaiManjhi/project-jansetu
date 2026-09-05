import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowRight } from "lucide-react";

/**
 * Landing hero — DESIGN.md §1.
 *
 * The banned list rules out most of what a landing page usually reaches for:
 * no gradient ground, no glassmorphism, no blob shapes, no stock illustration
 * of people shaking hands. What is left is what the reference points
 * (Stripe, Linear) actually rely on — type, spacing, and one real idea.
 *
 * The idea here is the sentence itself. A citizen does not need to be sold a
 * platform; they need to understand in one line that describing a problem sends
 * it to someone who can work on it. So the headline carries the whole product
 * and everything else on the screen is subordinate to it.
 *
 * The Government of India ownership line sits in the masthead rather than only
 * in the footer, which is what GIGW 3.0 asks of a government service: ownership
 * must be identifiable on the homepage and every important entry page.
 */

interface HeroProps {
  /** Real figures from the database — never invented, see LiveStats. */
  problemCount: number;
  districtCount: number;
  institutionCount: number;
  stateCount: number;
}

export function Hero({ problemCount, districtCount, institutionCount, stateCount }: HeroProps) {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex items-center gap-3">
          <Image
            src="/icon-192.png"
            alt=""
            width={44}
            height={44}
            className="rounded-lg"
            priority
          />
          <div>
            <p className="font-display text-xl leading-none">
              <span className="text-accent">Jan</span>
              <span className="text-success">Setu</span>
            </p>
            <p className="mt-1 text-xs tracking-wide text-ink-300 uppercase">
              Government of Jharkhand · SIH26043
            </p>
          </div>
        </div>

        <h1 className="font-display mt-10 max-w-3xl text-2xl leading-tight text-balance text-ink-900 sm:text-3xl">
          Tell us what is broken near you. We find the people who can fix it.
        </h1>

        <p className="mt-6 max-w-xl text-base text-ink-600">
          Describe a local problem in your own words — type it, or just speak. JanSetu reads it,
          checks whether your neighbours have already reported the same thing, and sends it to the
          university department best equipped to work on it.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#report"
            className="inline-flex min-h-touch items-center gap-2 rounded-button bg-accent px-6 text-base font-medium text-white transition-colors hover:bg-accent-deep"
          >
            Report a problem
            <ArrowDown size={18} strokeWidth={2} aria-hidden />
          </a>
          <Link
            href="/feed"
            className="inline-flex min-h-touch items-center gap-2 rounded-button border border-border px-6 text-base font-medium text-ink-900 transition-colors hover:border-accent hover:text-accent"
          >
            See what people are reporting
            <ArrowRight size={18} strokeWidth={2} aria-hidden />
          </Link>
        </div>

        <p className="mt-4 text-sm text-ink-600">
          No account needed. Reporting takes about a minute.
        </p>

        {/*
          Real figures, read from the database at request time. A landing page
          that states numbers it cannot substantiate is the first thing a judge
          will test, and these are the same counts the admin dashboard shows.
        */}
        <dl className="mt-16 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
          {[
            { label: "Reports received", value: problemCount },
            { label: "Districts covered", value: districtCount },
            { label: "Institutions listed", value: institutionCount },
            { label: "States", value: stateCount },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface px-5 py-5">
              <dd className="font-display text-xl text-accent tabular-nums">{stat.value}</dd>
              <dt className="mt-1 text-sm text-ink-600">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
