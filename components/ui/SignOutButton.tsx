"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

/**
 * Sign out. There was previously no way to do this anywhere in the app —
 * switching between the four roles meant clearing cookies by hand, which is
 * not something to discover while demonstrating on stage.
 */
export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/" })}
      className="inline-flex items-center gap-1.5 text-sm text-ink-600 transition-colors hover:text-accent"
    >
      <LogOut size={16} strokeWidth={1.5} aria-hidden />
      Sign out
    </button>
  );
}
