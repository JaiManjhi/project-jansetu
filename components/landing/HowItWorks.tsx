/**
 * What actually happens to a report — DESIGN.md §1.
 *
 * Numbered because this genuinely is a sequence: each step consumes the output
 * of the one before it, and the order is the product. That is the test §1's
 * structure rule sets for numbered markers, and this passes it where a numbered
 * list of "features" would not.
 *
 * The drawing is a bridge, in one colour, built from the same arch the logo
 * uses — a setu. It carries information rather than decorating: the spans are
 * the stages, and the pier positions are where the handoffs happen. No blobs,
 * no gradient, nothing that would read as generic SaaS artwork.
 */

const STEPS = [
  {
    n: "01",
    title: "You describe it",
    body: "Type or speak, in English, Hindi, Bengali or Marathi. Add a photo and a location if you can.",
    who: "Citizen",
  },
  {
    n: "02",
    title: "It gets understood",
    body: "The system reads the report, gives it a category and a severity, and checks whether your neighbours already reported the same thing.",
    who: "JanSetu",
  },
  {
    n: "03",
    title: "It reaches the right department",
    body: "Not the nearest university — the one whose research actually fits. Every match comes with a written reason you can read.",
    who: "JanSetu",
  },
  {
    n: "04",
    title: "Someone takes it on",
    body: "A university claims the work, industry partners offer funding or mentorship, and the state watches the whole picture.",
    who: "University · Industry · Government",
  },
];

export function HowItWorks() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="font-display text-xl text-ink-900">What happens to your report</h2>
        <p className="mt-3 max-w-xl text-base text-ink-600">
          Four stages. You only do the first one.
        </p>

        {/* Decorative only — the same information is in the list below, so this
            is hidden from assistive technology rather than read out twice. */}
        <svg
          viewBox="0 0 960 120"
          className="mt-12 h-auto w-full text-accent"
          aria-hidden
          focusable="false"
        >
          <line x1="0" y1="96" x2="960" y2="96" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          {[120, 360, 600, 840].map((x) => (
            <g key={x}>
              <path
                d={`M ${x - 110} 96 Q ${x} 26 ${x + 110} 96`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                opacity="0.55"
              />
              <line x1={x} y1="26" x2={x} y2="96" stroke="currentColor" strokeWidth="2" opacity="0.35" />
              <circle cx={x} cy="26" r="6" fill="currentColor" />
            </g>
          ))}
        </svg>

        <ol className="mt-4 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.n} className="flex flex-col bg-surface p-6">
              <span className="font-display text-sm text-accent tabular-nums">{step.n}</span>
              <h3 className="mt-3 text-base font-semibold text-ink-900">{step.title}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-600">{step.body}</p>
              <p className="mt-4 text-xs tracking-wide text-ink-300 uppercase">{step.who}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
