/**
 * Seeds demo problems so the admin heatmap shows real national spread.
 *
 *   npm run seed:demo            add demo problems
 *   npm run seed:demo -- --reset wipe the problems collection first
 *
 * The text and categories come from eval/classification-set.json — the same
 * 150 hand-labelled problems the accuracy number is measured against. That
 * matters: the map is populated with realistic civic problems carrying their
 * TRUE categories, not lorem ipsum with random labels, so the category
 * breakdown on the dashboard is meaningful rather than decorative.
 *
 * ⚠ These rows deliberately carry NO embedding. Generating 150 would spend
 * free-tier quota to make demo rows dedup-comparable, which nothing needs —
 * the live demo submits its own original and duplicate. The consequence, and
 * it is intentional: a submission will never be merged into a demo row.
 */
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { Problem } from "../models/Problem.ts";
import type { Category } from "../lib/constants.ts";

interface EvalItem {
  id: string;
  expected: Category;
  description: string;
}

interface DistrictCentroid {
  district: string;
  state: string;
  lat: number;
  lng: number;
}

/**
 * Deterministic PRNG so a re-seed produces the same map. A demo that looks
 * different every rehearsal is a demo you cannot rehearse.
 */
function makeRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function titleFrom(description: string): string {
  const first = description.split(/(?<=[.!?])\s/)[0] ?? description;
  const cleaned = first.trim().replace(/\s+/g, " ");
  return cleaned.length <= 80 ? cleaned : cleaned.slice(0, 77).trimEnd() + "…";
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — see SETUP.md");

  const items = JSON.parse(readFileSync("eval/classification-set.json", "utf8")) as EvalItem[];
  const districts = JSON.parse(readFileSync("data/districts.json", "utf8")) as DistrictCentroid[];

  await mongoose.connect(uri, { bufferCommands: false });

  if (process.argv.includes("--reset")) {
    const { deletedCount } = await Problem.deleteMany({});
    console.log(`--reset: removed ${deletedCount} existing problems`);
  }

  const random = makeRandom(20260902);

  // Spread across many states rather than clustering in one. Jharkhand is
  // over-weighted on purpose: the problem statement originates there and the
  // demo is anchored on it, but the map must still look national (PRD §8).
  const focusStates = [
    "Jharkhand", "Jharkhand", "Jharkhand",
    "Bihar", "Odisha", "West Bengal", "Chhattisgarh", "Madhya Pradesh",
    "Uttar Pradesh", "Rajasthan", "Maharashtra", "Karnataka", "Tamil Nadu",
    "Kerala", "Gujarat", "Assam", "Punjab", "Telangana", "Andhra Pradesh",
    "Himachal Pradesh", "Uttarakhand", "Meghalaya",
  ];
  const byState = new Map<string, DistrictCentroid[]>();
  for (const d of districts) {
    const list = byState.get(d.state);
    if (list) list.push(d);
    else byState.set(d.state, [d]);
  }

  const now = Date.now();
  const docs = items.map((item, index) => {
    const state = focusStates[index % focusStates.length] ?? "Jharkhand";
    const candidates = byState.get(state) ?? districts;
    const district = candidates[Math.floor(random() * candidates.length)] ?? districts[0]!;

    // Scatter within roughly ±25km of the centroid so points do not stack into
    // one dot per district, which would read as a bug rather than a cluster.
    const lat = district.lat + (random() - 0.5) * 0.45;
    const lng = district.lng + (random() - 0.5) * 0.45;

    const isGps = random() > 0.35;

    return {
      title: titleFrom(item.description),
      description: item.description,
      language: "en",
      category: item.expected,
      severityScore: 40 + Math.floor(random() * 55),
      location: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
      locationSource: isGps ? ("gps" as const) : ("manual" as const),
      locationAccuracyM: isGps ? 5 + Math.floor(random() * 40) : null,
      district: district.district,
      state: district.state,
      mediaUrls: [],
      submittedBy: null,
      status: "processing" as const,
      needsReview: false,
      duplicateOf: null,
      upvoteCount: Math.floor(random() * random() * 12),
      // Spread over the last 60 days so a date filter has something to bite on.
      createdAt: new Date(now - Math.floor(random() * 60) * 864e5),
      updatedAt: new Date(),
    };
  });

  await Problem.insertMany(docs, { ordered: false });

  const states = new Set(docs.map((d) => d.state));
  const gps = docs.filter((d) => d.locationSource === "gps").length;
  console.log(`inserted ${docs.length} demo problems`);
  console.log(`states/UTs covered: ${states.size}`);
  console.log(`gps-located: ${gps} · manually placed: ${docs.length - gps}`);
  console.log("\nNote: demo rows carry no embedding, so nothing will dedup against them.");

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
