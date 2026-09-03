/**
 * Seeds a small, believable Jharkhand caseload that is ROUTED.
 *
 *   npm run seed:jharkhand              add the set
 *   npm run seed:jharkhand -- --reset   delete this set first, then re-add
 *
 * ## Why this exists alongside seed:demo
 *
 * `seed:demo` fills the admin heatmap from the 150-item eval set, deliberately
 * without embeddings — it makes the map look national for a fraction of the
 * quota. What it cannot do is populate a university queue, because a queue is
 * driven by `Match` rows and those only exist for problems that went through
 * routing. The consequence was that every institution dashboard read "No
 * problems are waiting for your institution", which looks like a broken
 * product rather than an empty one.
 *
 * This script runs the SAME pipeline steps as `POST /api/problems`, in the same
 * order (embed → dedup → classify → match), calling the same functions rather than
 * reimplementing them, so demo rows are indistinguishable from rows a citizen
 * created. It writes directly instead of going through the HTTP route only
 * because that route is rate-limited to 20/hour per IP — a limit that protects
 * production and would otherwise block a re-seed during rehearsal.
 *
 * The problems are written to route somewhere real: several target departments
 * that genuinely exist in Jharkhand institutions (NIT Jamshedpur's civil and
 * metallurgy groups, IIT ISM's mining work, BAU's agriculture), so the reason
 * lines a judge reads are true statements about that institution.
 */
import mongoose from "mongoose";
import { Problem } from "../models/Problem.ts";
import { Match } from "../models/Match.ts";
import { embedText } from "../lib/ai/embed.ts";
import { classifyProblem } from "../lib/ai/classify.ts";
import { matchProblem } from "../lib/ai/match.ts";
import { findDuplicate } from "../lib/ai/dedup.ts";
import { resolveDistrict, toGeoPoint } from "../lib/geo/district.ts";
import { deriveTitle } from "../lib/validators.ts";

interface Seed {
  description: string;
  lat: number;
  lng: number;
  /** Days in the past, so the feed is not one identical timestamp. */
  daysAgo: number;
  /** Extra upvotes, so "most supported first" has something to sort. */
  upvotes: number;
}

/**
 * --reset identifies this script's rows by their exact descriptions rather
 * than by a marker field. DATA_MODEL.md defines what a Problem carries and a
 * "seeded by a script" flag is not part of it; adding one to make a dev tool
 * convenient would put a field in production documents that the product does
 * not use. The descriptions below are unique and stable, which is enough.
 */
function demoDescriptions(): string[] {
  return [...SEEDS, NEAR_DUPLICATE].map((s) => s.description);
}

const SEEDS: Seed[] = [
  {
    description:
      "The pedestrian bridge over the Kharkai river near Adityapur has developed visible cracks along two of its concrete pillars, and the railing has come loose on the eastern side. Around four hundred schoolchildren cross it every morning and it shakes when a heavy vehicle passes.",
    lat: 22.7868, lng: 86.1517, daysAgo: 2, upvotes: 14,
  },
  {
    description:
      "A private unit behind our basti has been dumping steel slag and fly ash on open ground for the past six months. When it rains the runoff turns the pond black, and the cattle that drink there have started falling sick. Nothing grows on that patch any more.",
    lat: 22.8046, lng: 86.2029, daysAgo: 5, upvotes: 21,
  },
  {
    description:
      "Every monsoon the drainage in our ward backs up and knee-deep water stands for three or four days at a stretch. The water enters ground floor rooms, and last year two families lost everything stored at floor level. The drain has never been desilted.",
    lat: 22.7596, lng: 86.1517, daysAgo: 8, upvotes: 9,
  },
  {
    description:
      "The hand pump near the government middle school has been broken for three months. Women from about sixty households now walk close to two kilometres to the next working pump, and they start before sunrise to avoid the queue.",
    lat: 23.3441, lng: 85.3096, daysAgo: 11, upvotes: 27,
  },
  {
    description:
      "Our village primary school has no electricity connection. Classes stop by three in the afternoon during the monsoon because the rooms are too dark to read in, and the computers donated last year are still in their boxes.",
    lat: 23.3629, lng: 85.3346, daysAgo: 6, upvotes: 12,
  },
  {
    description:
      "The primary health centre has had no doctor posted for over a year. A pharmacist opens it three days a week and hands out whatever is in stock. For anything serious people hire a jeep to Hazaribagh town, which costs more than a day's wage.",
    lat: 23.9925, lng: 85.3637, daysAgo: 4, upvotes: 33,
  },
  {
    description:
      "The irrigation canal that feeds our fields has silted up so badly that water stops about a kilometre short of the village. Two hundred acres that used to take a rabi crop are now single-crop land, and families have started sending sons out for work.",
    lat: 24.0333, lng: 84.0667, daysAgo: 13, upvotes: 18,
  },
  {
    description:
      "Effluent from the industrial area is being released into the river upstream of where we draw water. The water has a chemical smell in the mornings and children who bathe there develop skin rashes. Nobody has tested it as far as we know.",
    lat: 23.6693, lng: 86.1511, daysAgo: 9, upvotes: 24,
  },
  {
    description:
      "The block development office has no ramp and the only entrance is up seven steep steps. My father uses a wheelchair after his stroke and has not been able to go inside once. People carry him up, which is unsafe and humiliating.",
    lat: 24.4823, lng: 86.6947, daysAgo: 15, upvotes: 7,
  },
  {
    description:
      "The solar street lights installed two years ago have all stopped working. The panels are still on the poles but no light comes on, and nobody has come to repair them. Women avoid the road after dark now.",
    lat: 24.1913, lng: 86.3009, daysAgo: 7, upvotes: 16,
  },
  {
    description:
      "The approach road to our village was washed away in the last heavy rain and has not been repaired. An ambulance cannot reach us. A pregnant woman had to be carried on a cot for three kilometres last month to meet the vehicle.",
    lat: 22.5626, lng: 85.8236, daysAgo: 3, upvotes: 29,
  },
  {
    description:
      "Our women's self-help group makes lac bangles and sal leaf plates but we have no way to reach buyers beyond the weekly haat. Traders take most of the margin. We need help with packaging, pricing and finding a steady buyer.",
    lat: 23.0716, lng: 85.2784, daysAgo: 17, upvotes: 11,
  },
  {
    description:
      "Applications for caste and residence certificates at the block office take six to eight months, and each visit means a lost day of work. Students miss scholarship deadlines because of it. There is no way to check the status of an application.",
    lat: 23.3700, lng: 85.3250, daysAgo: 12, upvotes: 22,
  },
  {
    description:
      "Coal dust from open trucks passing through the village settles on everything, including the drinking water stored outside. Elderly people cough constantly through the dry season and the school compound has a black film on it by afternoon.",
    lat: 23.7420, lng: 86.4120, daysAgo: 10, upvotes: 19,
  },
];

/**
 * A deliberate near-duplicate of the broken hand pump above, to demonstrate
 * deduplication with real data instead of asking a judge to imagine it. Seeded
 * last so the original exists and is indexed by the time this is compared.
 */
const NEAR_DUPLICATE: Seed = {
  description:
    "Hand pump close to the govt middle school is not working since around three months. Ladies of our mohalla have to walk nearly 2 km every morning to bring drinking water.",
  lat: 23.3448, lng: 85.3102, daysAgo: 1, upvotes: 0,
};

/**
 * Groq's free tier caps tokens per minute, not just requests, and each problem
 * here spends one classification plus up to three reason generations. Seeding
 * flat out hit "Rate limit reached ... tokens per minute (TPM): Limit 8000"
 * on the tenth problem and aborted the run half-seeded. Pacing is cheaper than
 * retrying, and a seeder that takes four minutes but always finishes is worth
 * more than one that is fast until it is not.
 */
const PACE_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries on the provider errors that are transient, with backoff. */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [15_000, 45_000, 90_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const delay = delays[attempt];
      if (delay === undefined) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("429") && !message.toLowerCase().includes("rate limit")) throw error;
      console.log(`     ${label}: rate limited, waiting ${delay / 1000}s…`);
      await sleep(delay);
    }
  }
}

function daysAgoDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function seedOne(seed: Seed, index: number, total: number): Promise<void> {
  const { district, state } = resolveDistrict(seed.lat, seed.lng);
  const label = `${index + 1}/${total} ${district}`;

  const embedding = await withRetry("embed", () => embedText(seed.description));
  const classification = await withRetry("classify", () => classifyProblem(seed.description));
  const createdAt = daysAgoDate(seed.daysAgo);

  const problem = await Problem.create({
    title: deriveTitle(seed.description),
    description: seed.description,
    language: "en",
    category: classification.category,
    severityScore: classification.severityScore,
    location: toGeoPoint(seed.lat, seed.lng),
    locationSource: "gps",
    locationAccuracyM: 30,
    district,
    state,
    mediaUrls: [],
    submittedBy: null,
    status: "processing",
    needsReview: false,
    embedding,
    upvoteCount: seed.upvotes,
    createdAt,
    updatedAt: createdAt,
  });

  /**
   * Dedup, exactly as the route does it. Skipping this was a real defect: the
   * near-duplicate below was seeded as its own row, so the feed showed two
   * near-identical hand pump reports — the precise thing this product claims to
   * prevent, on the screen a judge looks at first.
   */
  const dedup = await findDuplicate(embedding, district, problem._id);
  if (dedup.isDuplicate && dedup.bestMatch) {
    problem.status = "duplicate_merged";
    problem.duplicateOf = dedup.bestMatch.problemId as unknown as typeof problem.duplicateOf;
    await problem.save();
    await Problem.updateOne({ _id: dedup.bestMatch.problemId }, { $inc: { upvoteCount: 1 } });
    console.log(
      `  ${label.padEnd(28)} ${classification.category.padEnd(15)} → MERGED into an existing report (similarity ${dedup.bestMatch.similarity.toFixed(3)})`,
    );
    return;
  }

  const matches = await withRetry("match", () =>
    matchProblem(embedding, seed.lat, seed.lng, seed.description, classification.category),
  );

  if (matches.length > 0) {
    await Match.insertMany(
      matches.map((m) => ({
        problemId: problem._id,
        institutionId: m.institutionId,
        score: m.score,
        distanceKm: m.distanceKm,
        matchedDepartment: m.matchedDepartment,
        reason: m.reason,
        rank: m.rank,
      })),
    );
    problem.status = "routed";
    await problem.save();
  }

  const top = matches[0];
  console.log(
    `  ${label.padEnd(28)} ${classification.category.padEnd(15)} sev ${String(
      classification.severityScore,
    ).padStart(3)}  →  ${top ? `${top.institutionName} (${top.matchedDepartment ?? "no dept"})` : "NOT ROUTED"}`,
  );
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see SETUP.md");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });

  if (process.argv.includes("--reset")) {
    const doomed = await Problem.find({ description: { $in: demoDescriptions() } })
      .select("_id")
      .lean();
    const ids = doomed.map((d) => d._id);
    await Match.deleteMany({ problemId: { $in: ids } });
    await Problem.deleteMany({ _id: { $in: ids } });
    console.log(`Reset: removed ${ids.length} demo problems and their matches.\n`);
  }

  console.log(`Seeding ${SEEDS.length + 1} routed Jharkhand problems…\n`);
  for (const [index, seed] of SEEDS.entries()) {
    await seedOne(seed, index, SEEDS.length + 1);
    await sleep(PACE_MS);
  }

  // The near-duplicate goes through the same pipeline; whether dedup catches it
  // is exactly what we want to observe, so it is not forced either way.
  await seedOne(NEAR_DUPLICATE, SEEDS.length, SEEDS.length + 1);

  const routed = await Problem.countDocuments({
    description: { $in: demoDescriptions() },
    status: "routed",
  });
  console.log(`\nDone. ${routed} of ${SEEDS.length + 1} routed to at least one institution.`);
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
