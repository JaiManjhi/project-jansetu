import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * DESIGN.md §5 — solid accent for primary, outline for secondary. No gradient
 * fills, ever. 8px radius. Minimum 44px tall: citizens are on phones, often
 * outdoors and one-handed (§9).
 */

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-[#a84a1a] disabled:bg-ink-300 disabled:cursor-not-allowed",
  secondary:
    "bg-surface text-ink-900 border border-border hover:bg-accent-subtle disabled:text-ink-300 disabled:cursor-not-allowed",
  ghost: "text-ink-600 hover:text-ink-900 hover:bg-accent-subtle",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // A color transition only — DESIGN.md §7 rules out motion on hover.
      className={`inline-flex min-h-touch items-center justify-center gap-2 rounded-button px-5 text-base font-medium transition-colors ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
