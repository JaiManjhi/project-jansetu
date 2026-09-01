/**
 * Day 1 placeholder. TASKS.md Day 1 wants a deployable page that proves the
 * pipeline works end to end before any feature is built on top of it.
 *
 * On Day 6-7 the citizen submission form replaces this, moving to
 * app/(citizen)/page.tsx per ARCHITECTURE.md §5 — that route group also
 * resolves to "/", so this file is deleted at that point rather than kept.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-accent uppercase">
        SIH26043
      </p>

      <h1 className="font-display mt-3 text-3xl text-ink-900">JanSetu</h1>

      <p className="mt-4 max-w-prose text-base text-ink-600">
        Citizens report local problems. Each one is classified, checked against
        what has already been reported nearby, and routed to the university best
        equipped to solve it.
      </p>

      <div className="mt-12 rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg text-ink-900">Foundation in place</h2>
        <p className="mt-2 text-sm text-ink-600">
          Nothing here is wired to real data yet. This page exists to confirm
          the deploy pipeline before any feature is built on top of it.
        </p>

        <ul className="mt-6 space-y-3">
          {[
            "Next.js 16, App Router, TypeScript strict",
            "Design tokens from DESIGN.md §2-4",
            "Mongoose schemas for all six collections",
            "NextAuth credentials, four roles",
          ].map((item) => (
            <li
              key={item}
              className="flex items-baseline gap-3 text-sm text-ink-600"
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-success"
              />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-8 text-sm text-ink-300">
        Next: institution and district data, then the AI engine.
      </p>
    </main>
  );
}
