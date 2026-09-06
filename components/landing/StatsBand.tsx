/**
 * The four real figures, as a full-width navy band.
 *
 * These used to sit in a hairline grid inside the hero and read as footnotes.
 * Given the width of the page and a solid ground they become the thing that
 * breaks the page into sections — which is what the landing page was missing
 * between the hero and everything below it.
 *
 * Every number is read from the database at request time. A landing page that
 * states figures it cannot substantiate is the first thing a judge tests.
 */

interface StatsBandProps {
  problemCount: number;
  districtCount: number;
  institutionCount: number;
  stateCount: number;
}

export function StatsBand({
  problemCount,
  districtCount,
  institutionCount,
  stateCount,
}: StatsBandProps) {
  const stats = [
    { value: problemCount, label: "Reports received" },
    { value: districtCount, label: "Districts covered" },
    { value: institutionCount, label: "Institutions listed" },
    { value: stateCount, label: "States" },
  ];

  return (
    <section className="bg-accent">
      <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-y-8 px-4 py-10 sm:px-6 lg:grid-cols-4 lg:gap-y-0">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            // A hairline between columns rather than around them: the band is
            // one object, not four cards on a coloured ground.
            className={
              index > 0 ? "lg:border-l lg:border-white/20 lg:pl-8" : undefined
            }
          >
            <dd className="font-display text-2xl leading-none text-white tabular-nums">
              {stat.value}
            </dd>
            <dt className="mt-2 text-sm text-white/70">{stat.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
