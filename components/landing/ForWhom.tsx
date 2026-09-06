import Link from "next/link";
import { Users, GraduationCap, Building2, Landmark, ArrowRight } from "lucide-react";

/**
 * The four sides of the platform, each with its own way in.
 *
 * Every card ends in a real button. The previous version ended each in an
 * underlined text link, which is exactly the pattern the 2026-09-07 direction
 * change was written to stop: the primary action on a card should not look
 * like a footnote.
 *
 * ⚠ Three of these four buttons go to /login, and that is correct. There is no
 * self-registration for universities, industry or government — accounts are
 * provisioned, because anyone could otherwise register as a university and
 * start claiming civic problems. The generated design this came from offered a
 * "Register institution" button; wiring that up would have promised a flow that
 * does not exist and should not.
 */

const AUDIENCES = [
  {
    icon: Users,
    tile: "bg-accent",
    role: "Citizens",
    line: "Report a problem where you live. No account, no forms, no waiting room.",
    action: { label: "Report a problem", href: "#report" },
  },
  {
    icon: GraduationCap,
    tile: "bg-success",
    role: "Universities",
    line: "See problems matched to your departments' real expertise, with the reasoning shown.",
    action: { label: "Coordinator sign in", href: "/login" },
  },
  {
    icon: Building2,
    tile: "bg-severity",
    role: "Industry",
    line: "Back work a university has already committed to — funding, mentorship or prototyping.",
    action: { label: "Partner sign in", href: "/login" },
  },
  {
    icon: Landmark,
    tile: "bg-accent-deep",
    role: "Government",
    line: "Where problems are reported, what is being solved, and which institutions carry the load.",
    action: { label: "Administrator sign in", href: "/login" },
  },
];

export function ForWhom() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl text-ink-900 sm:text-2xl">
            Four sides of the same problem
          </h2>
          <p className="mt-3 text-base text-ink-600">
            Anyone can report. The other three are provisioned accounts, not open sign-ups —
            otherwise anyone could register as a university and start claiming civic problems.
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCES.map(({ icon: Icon, tile, role, line, action }) => (
            <div
              key={role}
              className="flex flex-col rounded-card border border-border bg-surface p-6 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
            >
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-button ${tile}`}
              >
                <Icon size={22} strokeWidth={1.75} className="text-white" aria-hidden />
              </span>

              <h3 className="mt-5 text-base font-semibold text-ink-900">{role}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-600">{line}</p>

              {action.href.startsWith("#") ? (
                <a
                  href={action.href}
                  className="mt-6 inline-flex min-h-touch items-center justify-center gap-2 rounded-button bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-deep"
                >
                  {action.label}
                  <ArrowRight size={16} strokeWidth={2.25} aria-hidden />
                </a>
              ) : (
                <Link
                  href={action.href}
                  className="mt-6 inline-flex min-h-touch items-center justify-center gap-2 rounded-button border border-border px-4 text-sm font-semibold text-ink-900 transition-colors hover:border-accent hover:text-accent"
                >
                  {action.label}
                  <ArrowRight size={16} strokeWidth={2.25} aria-hidden />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
