/**
 * Creates the credential accounts. ARCHITECTURE.md §7 — university, industry
 * and admin authenticate with credentials against pre-seeded accounts;
 * citizens never authenticate at all.
 *
 *   npm run seed:users
 *
 * Passwords are GENERATED and printed once, not hardcoded. A password
 * committed to a repository is a password on demo day too, and this repo will
 * be shown to judges. Override with ADMIN_PASSWORD / UNIVERSITY_PASSWORD /
 * INDUSTRY_PASSWORD in .env.local if you want stable ones for rehearsal.
 *
 * Safe to re-run: an existing account is updated in place, never duplicated.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { User } from "../models/User.ts";
import { Institution } from "../models/Institution.ts";

function generatePassword(): string {
  // 18 URL-safe chars — long enough that the printed value is not the weak link.
  return randomBytes(14).toString("base64url");
}

interface SeedSpec {
  role: "admin" | "university" | "industry";
  email: string;
  name: string;
  envVar: string;
  organizationName?: string;
}

const SEEDS: SeedSpec[] = [
  { role: "admin", email: "admin@jansetu.gov.in", name: "State Admin", envVar: "ADMIN_PASSWORD" },
  {
    role: "university",
    email: "coordinator@nitjsr.ac.in",
    name: "University Coordinator",
    envVar: "UNIVERSITY_PASSWORD",
  },
  {
    role: "industry",
    email: "csr@partner.example.com",
    name: "Industry Partner",
    envVar: "INDUSTRY_PASSWORD",
    organizationName: "Example CSR Foundation",
  },
];

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see SETUP.md");
  await mongoose.connect(uri, { bufferCommands: false });

  // A university account needs an institution to belong to. Prefer one that
  // actually matches the account email — coordinator@nitjsr.ac.in belongs at
  // NIT Jamshedpur, and linking it to whichever institution happened to be
  // first makes the demo nonsensical. Falls back to any institution rather
  // than failing, since institution data lands separately.
  const anyInstitution =
    (await Institution.findOne({ name: /NIT Jamshedpur/i }).select("_id name").lean()) ??
    (await Institution.findOne().select("_id name").lean());

  const printed: Array<[string, string, string]> = [];

  for (const spec of SEEDS) {
    if (spec.role === "university" && !anyInstitution) {
      console.warn(
        `skipped ${spec.email}: no institutions seeded yet, and a university account requires institutionId`,
      );
      continue;
    }

    const password = process.env[spec.envVar] ?? generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);

    await User.findOneAndUpdate(
      { email: spec.email },
      {
        role: spec.role,
        name: spec.name,
        email: spec.email,
        passwordHash,
        institutionId: spec.role === "university" ? anyInstitution?._id : null,
        organizationName: spec.organizationName ?? null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );

    printed.push([spec.role, spec.email, password]);
  }

  await mongoose.disconnect();

  console.log("\nAccounts ready. These passwords are shown ONCE — save them now:\n");
  for (const [role, email, password] of printed) {
    console.log(`  ${role.padEnd(11)} ${email.padEnd(30)} ${password}`);
  }
  console.log("\nSign in at /login\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
