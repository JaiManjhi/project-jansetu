import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/constants";

/**
 * Module augmentation so `session.user.role` is typed everywhere instead of
 * being reached for with a cast. Without this, every authorization check in the
 * codebase would need an `as` — which is exactly how a role check silently
 * becomes a no-op.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      institutionId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    institutionId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    institutionId: string | null;
  }
}
