import Link from "next/link";
import { Users, GraduationCap, Building2, Landmark } from "lucide-react";

/**
 * The four sides of the platform, and how to get in.
 *
 * This section exists because "who is this for" is the first question a judge
 * asks and the first thing a coordinator arriving from an email needs. It also
 * does something practical: it is the only place in the product that explains
 * why three of the four roles have no sign-up button, which otherwise reads as
 * a missing feature rather than a deliberate one.
 *
 * Icons are line icons at a consistent weight, per DESIGN.md §6 — never emoji.
 */

const AUDIENCES = [
  {
    icon: Users,
    role: "Citizens",
    line: "Report a problem where you live. No account, no form-filling, no waiting room.",
    action: { label: "Report a problem", href: "#report" },
  },
  {
    icon: GraduationCap,
    role: "Universities",
    line: "See problems matched to your departments' actual expertise, with the reasoning shown. Claim what you can resource.",
    action: { label: "Coordinator sign in", href: "/login" },
  },
  {
    icon: Building2,
    role: "Industry partners",
    line: "Back work a university has already committed to. Offer funding, mentorship or prototyping.",
    action: { label: "Partner sign in", href: "/login" },
  },
  {
    icon: Landmark,
    role: "Government",
    line: "Where problems are being reported, what is being solved, and which institutions are carrying the load.",
    action: { label: "Administrator sign in", href: "/login" },
  },
];

export function ForWhom() {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="font-display text-xl text-ink-900">Four sides of the same problem</h2>
        <p className="mt-3 max-w-2xl text-base text-ink-600">
          Anyone can report. The other three roles are provisioned accounts, not open sign-ups —
          otherwise anyone could register as a university and start claiming civic problems.
        </p>

        <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-2">
          {AUDIENCES.map(({ icon: Icon, role, line, action }) => (
            <div key={role} className="flex flex-col bg-surface p-6">
              <Icon size={22} strokeWidth={1.5} className="text-accent" aria-hidden />
              <h3 className="mt-4 text-base font-semibold text-ink-900">{role}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-600">{line}</p>
              {action.href.startsWith("#") ? (
                <a
                  href={action.href}
                  className="mt-4 self-start text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  {action.label}
                </a>
              ) : (
                <Link
                  href={action.href}
                  className="mt-4 self-start text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  {action.label}
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
