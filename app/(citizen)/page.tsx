import { connectToDatabase } from "@/lib/db";
import { Problem } from "@/models/Problem";
import { Institution } from "@/models/Institution";
import { VISIBLE_PROBLEM_FILTER } from "@/lib/constants";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { StatsBand } from "@/components/landing/StatsBand";
import { RoutingFeature } from "@/components/landing/RoutingFeature";
import { ForWhom } from "@/components/landing/ForWhom";
import { ReportForm } from "@/components/citizen/ReportForm";

/**
 * The front door.
 *
 * A landing section first, then the report form on the same page under
 * `#report`, so "Report a problem" is a scroll rather than a navigation. The
 * form is the tested flow and is unchanged — it was lifted into a component so
 * this server page could render around it and read real figures for the hero.
 */

export const dynamic = "force-dynamic";

async function loadFigures() {
  await connectToDatabase();

  const [problemCount, districts, institutionCount, states] = await Promise.all([
    Problem.countDocuments({
      status: { $ne: "duplicate_merged" },
      ...VISIBLE_PROBLEM_FILTER,
    }),
    Problem.distinct("district", VISIBLE_PROBLEM_FILTER),
    Institution.countDocuments(),
    Institution.distinct("state"),
  ]);

  return {
    problemCount,
    districtCount: districts.length,
    institutionCount,
    stateCount: states.length,
  };
}

export default async function HomePage() {
  /**
   * A database outage must not take down the front door. The hero falls back to
   * zeros and the report form below still works — the citizen path is the one
   * thing on this page that has to survive everything, and the form posts to an
   * API that degrades on its own terms.
   */
  let figures = { problemCount: 0, districtCount: 0, institutionCount: 0, stateCount: 0 };
  try {
    figures = await loadFigures();
  } catch {
    // Deliberately silent for the reader; the API route logs its own failures.
  }

  return (
    <main className="flex-1">
      <Hero {...figures} />
      <StatsBand {...figures} />
      <HowItWorks />
      <RoutingFeature />

      {/* scroll-mt keeps the heading clear of the sticky site header when the
          hero's "Report a problem" jumps here. */}
      <section id="report" className="scroll-mt-4 border-b border-border">
        {/* max-w-xl, matching the form below it. At max-w-5xl the heading sat
            far to the left of the fields it introduces, which read as a broken
            column rather than a section header. */}
        <div className="mx-auto w-full max-w-xl px-4 pt-16 sm:px-6">
          <h2 className="font-display text-xl text-ink-900">Report a problem</h2>
          <p className="mt-3 max-w-xl text-base text-ink-600">
            Describe what is wrong in your own words. You can speak instead of typing, and you do
            not need an account.
          </p>
        </div>
        <ReportForm />
      </section>

      <ForWhom />
    </main>
  );
}
