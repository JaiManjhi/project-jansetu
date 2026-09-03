import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "@/lib/db";
import { User } from "@/models/User";
import type { Role } from "@/lib/constants";

/**
 * Auth per ARCHITECTURE.md §7.
 *
 * University, Industry and Admin all authenticate with credentials against
 * pre-seeded accounts. Citizens do NOT authenticate to submit — gating
 * submission behind a login contradicts the accessibility goal, and is the one
 * auth decision in this project that is not negotiable.
 *
 * Deferred: the optional citizen magic-link login for tracking submission
 * history. It needs an SMTP provider that SETUP.md does not currently list, and
 * nothing in the demo path depends on it. Submissions are tracked by id via
 * /track/[id] instead.
 */

export const authOptions: NextAuthOptions = {
  session: {
    // JWT rather than a database session: the Credentials provider requires it,
    // and it avoids a sessions collection we would otherwise have to model.
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        await connectToDatabase();

        // passwordHash is select:false on the schema, so it must be asked for
        // explicitly. This is the only place in the codebase that should.
        const user = await User.findOne({
          email: credentials.email.toLowerCase().trim(),
        })
          .select("+passwordHash")
          .lean();

        if (!user || !user.passwordHash) return null;

        // Citizens have no password and must never pass credential auth even
        // if a row somehow carries a hash.
        if (user.role === "citizen") return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.passwordHash,
        );
        if (!valid) return null;

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          institutionId: user.institutionId?.toString() ?? null,
        };
      },
    }),
  ],
  callbacks: {
    // Role and institutionId are carried on the token so that every API route
    // can authorize without a database round-trip per request.
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.institutionId = user.institutionId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role;
        session.user.institutionId = token.institutionId;
      }
      return session;
    },
  },
};

export interface SessionUser {
  id: string;
  role: Role;
  institutionId: string | null;
}

/** Returns the signed-in user, or null. */
/**
 * A session read that degrades to "signed out" instead of throwing.
 *
 * For CHROME ONLY — the header, and anything else decorative that renders on
 * every page. Never use it to guard a protected page or route.
 *
 * The reason it exists: SiteHeader renders in the root layout, so an exception
 * from getServerSession propagates out of EVERY page in the app. That is
 * exactly what happened on the first Vercel deploy — NEXTAUTH_SECRET was not
 * set, NextAuth threw "There is a problem with the server configuration", and
 * all six routes returned 500 including the public feed and the citizen report
 * form. A misconfigured session must not be able to take down a page that does
 * not need a session at all: a citizen reporting a problem is the one user who
 * never signs in, and they are the last person who should see a white screen.
 *
 * The failure is logged rather than swallowed, so a broken auth config is still
 * visible in the platform logs instead of silently showing everyone a
 * signed-out header.
 */
export async function getSessionUserForChrome(): Promise<SessionUser | null> {
  try {
    return await getSessionUser();
  } catch (error: unknown) {
    /**
     * Next.js signals "this route cannot be static" by THROWING out of
     * `headers()` during prerender, which getServerSession calls. That is
     * control flow, not a failure, and swallowing it would both spam the build
     * log with fake errors and risk a page being frozen as signed-out — a
     * logged-in coordinator would then see "Sign in" forever. Re-thrown so
     * Next handles it exactly as if this catch were not here.
     */
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE"
    ) {
      throw error;
    }

    console.error(
      `[auth] session lookup failed while rendering chrome; degrading to signed-out: ${
        error instanceof Error ? error.message : error
      }`,
    );
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.role) return null;
  return {
    id: session.user.id,
    role: session.user.role,
    institutionId: session.user.institutionId,
  };
}

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Server-side role guard for API routes.
 *
 * ARCHITECTURE.md §8: hiding a button client-side is not protection. Every
 * protected route calls this, and it throws rather than returning a nullable
 * so a forgotten null-check cannot silently become an authorization bypass.
 */
export async function requireRole(
  ...allowed: readonly Role[]
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new AuthError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  if (!allowed.includes(user.role)) {
    throw new AuthError(
      403,
      "FORBIDDEN",
      "Your account does not have access to this resource.",
    );
  }
  return user;
}
