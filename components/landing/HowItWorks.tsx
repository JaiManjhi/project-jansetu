import { PenLine, Sparkles, Route, HandHeart } from "lucide-react";

/**
 * What happens to a report — four elevated cards.
 *
 * Numbered because this genuinely is a sequence: each step consumes the output
 * of the one before it, and the order is the product. That is the test
 * DESIGN.md sets for numbered markers, and this passes it where a numbered
 * list of features would not.
 *
 * Rebuilt from a hairline grid into cards with a resting shadow, per the
 * 2026-09-07 direction change. The bridge drawing that used to sit above this
 * is gone: it competed with the hero photograph for the same job and won
 * neither.
 */

const STEPS = [
  {
    n: "1",
    icon: PenLine,
    title: "You describe it",
    body: "Type or speak, in English, Hindi, Bengali or Marathi. Add a photo and a location.",
    who: "Citizen",
  },
  {
    n: "2",
    icon: Sparkles,
    title: "It gets understood",
    body: "The report is read, categorised and given a severity — then checked against what your neighbours already reported.",
    who: "JanSetu",
  },
  {
    n: "3",
    icon: Route,
    title: "It reaches the right department",
    body: "Not the nearest university. The one whose research actually fits, with a written reason you can read.",
    who: "JanSetu",
  },
  {
    n: "4",
    icon: HandHeart,
    title: "Someone takes it on",
    body: "A university claims the work, industry partners back it, and the state sees the whole picture.",
    who: "University · Industry · Government",
  },
];

export function HowItWorks() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl text-ink-900 sm:text-2xl">
            What happens to your report
          </h2>
          <p className="mt-3 text-base text-ink-600">
            Four stages. You only do the first one.
          </p>
        </div>

        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ n, icon: Icon, title, body, who }) => (
            <li
              key={n}
              className="flex flex-col rounded-card border border-border bg-surface p-6 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-accent text-sm font-semibold text-accent tabular-nums">
                  {n}
                </span>
                <Icon size={20} strokeWidth={1.75} className="text-accent" aria-hidden />
              </div>

              <h3 className="mt-5 text-base font-semibold text-ink-900">{title}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-600">{body}</p>
              <p className="mt-5 border-t border-border pt-3 text-xs tracking-wide text-ink-300 uppercase">
                {who}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
