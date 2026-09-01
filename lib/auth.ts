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
