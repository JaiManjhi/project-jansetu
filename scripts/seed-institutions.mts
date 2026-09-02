/**
 * Loads institutions from a CSV into MongoDB and generates their embeddings.
 *
 *   npm run seed:institutions -- chhattisgarh-institutions.csv
 *   npm run seed:institutions -- a.csv b.csv --reset
 *   npm run seed:institutions -- --embed-only
 *
 * Expected columns (the shape of chhattisgarh-institutions.csv):
 *   Institution, State, District, Type, DataDepth, Department,
 *   ResearchAreas, SourceVerified
 *
 * One row per (institution, department) for deep profiles; one row per
 * institution for shallow ones. Rows are grouped by institution name + state.
 *
 * TWO PHASES, deliberately separable:
 *   1. Parse and upsert every institution. No API calls, so it always finishes.
 *   2. Embed only institutions still missing vectors, with backoff on 429.
 *
 * The split exists because the Gemini free tier runs out. A single-pass script
 * that dies halfway through leaves you with no idea what was written and burns
 * the successful calls on a re-run. `--embed-only` resumes phase 2 against
 * whatever is still unembedded, so hitting a quota wall costs nothing but time.
 */
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { Institution } from "../models/Institution.ts";
import { embedText } from "../lib/ai/embed.ts";
import { INSTITUTION_TYPE_ENUM, DATA_DEPTH_ENUM } from "../lib/constants.ts";

interface DistrictCentroid {
  district: string;
  state: string;
  lat: number;
  lng: number;
}

/** Minimal RFC4180 parser — quoted fields in this data contain commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Strips case, punctuation, dashes and spaces so name variants compare equal. */
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Damerau-Levenshtein — counts a transposition as ONE edit, not two.
 *
 * That distinction is load-bearing: the source contains "Kondagoan" for
 * "Kondagaon", a swapped pair. Plain Levenshtein scores that 2, which forces
 * the threshold up to 2, which is where wrong matches start being accepted.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99; // early out — we only care about small distances
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (d[i - 1]?.[j] ?? 99) + 1,
        (d[i]?.[j - 1] ?? 99) + 1,
        (d[i - 1]?.[j - 1] ?? 99) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (d[i - 2]?.[j - 2] ?? 99) + 1);
      }
      d[i]![j] = value;
    }
  }
  return d[m]?.[n] ?? 99;
}

/**
 * Genuine alternate names, where the two spellings are not close enough for
 * any distance measure to connect them safely.
 *
 * Kept deliberately tiny. Everything a structural rule can handle should be
 * handled structurally; this map is only for cases where guessing would be
 * unsafe and a human has confirmed the mapping.
 */
const DISTRICT_ALIASES: Record<string, string> = {
  // Romanisation variant of the same Chhattisgarh district. "Koriya" sits at
  // edit distance 2 from BOTH "Korea" and "Korba", so the matcher correctly
  // refuses to choose — this states which one it is.
  koriya: "Korea",
};

/**
 * Resolves a CSV district name to a district in data/districts.json.
 *
 * Source spellings drift from the official ones in every way you would expect:
 * an en-dash ("Janjgir – Champa"), a dropped prefix ("Dantewada" for "Dakshin
 * Bastar Dantewara"), an alternate name ("Koriya" for "Korea"), and plain
 * typos ("Kondagoan"). A hand-maintained alias list would need extending for
 * every new state, so match structurally instead: exact, then substring, then
 * edit distance ≤2 — always scoped to the same state, and every fuzzy match is
 * logged so a wrong one is visible rather than silent.
 */
function resolveDistrict(
  districts: DistrictCentroid[],
  state: string,
  district: string,
  fuzzyLog: string[],
): DistrictCentroid | null {
  const inState = districts.filter((d) => normalize(d.state) === normalize(state));
  const pool = inState.length > 0 ? inState : districts;
  const target = normalize(district);
  if (!target) return null;

  const alias = DISTRICT_ALIASES[target];
  if (alias) {
    const aliased = pool.find((d) => normalize(d.district) === normalize(alias));
    if (aliased) {
      fuzzyLog.push(`"${district}" -> "${aliased.district}" (known alias)`);
      return aliased;
    }
  }

  const exact = pool.find((d) => normalize(d.district) === target);
  if (exact) return exact;

  const substring = pool.find((d) => {
    const n = normalize(d.district);
    return n.includes(target) || target.includes(n);
  });
  if (substring) {
    fuzzyLog.push(`"${district}" -> "${substring.district}" (substring)`);
    return substring;
  }

  /**
   * Nearest match at edit distance ≤1, whole name or any single word of it —
   * the word form catches "Dantewada" inside "Dakshin Bastar Dantewara".
   *
   * Two rules keep this honest. The threshold is 1, not 2: at 2 the matcher
   * accepted "Koriya" as "Korba" (a different district) purely because it
   * sorted first. And a tie at the best distance is REFUSED rather than
   * broken arbitrarily — an unresolved district gets reported and skipped,
   * which is recoverable, while a silently wrong one puts an institution in
   * the wrong place on the map and in the routing distance penalty.
   */
  const scored = pool
    .map((d) => {
      const whole = editDistance(target, normalize(d.district));
      const perWord = Math.min(
        ...d.district.split(/[\s\-()]+/).filter(Boolean).map((w) => editDistance(target, normalize(w))),
        99,
      );
      return { d, distance: Math.min(whole, perWord) };
    })
    .filter((s) => s.distance <= 1)
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  if (!best) return null;

  const tied = scored.filter((s) => s.distance === best.distance);
  if (tied.length > 1) {
    fuzzyLog.push(
      `"${district}" AMBIGUOUS at distance ${best.distance}: ${tied.map((t) => t.d.district).join(" / ")} — skipped`,
    );
    return null;
  }

  fuzzyLog.push(`"${district}" -> "${best.d.district}" (edit distance ${best.distance})`);
  return best.d;
}

/**
 * Research areas honestly marked as not yet gathered.
 *
 * The source says "NEEDS RESEARCH" where a department is confirmed to exist
 * but its faculty expertise has not been pulled. That honesty is useful — but
 * the phrase must never reach capabilityText, or it gets embedded as if it
 * were a research area and drags matches toward whatever it sits near in
 * vector space.
 */
const isPlaceholder = (value: string): boolean => /needs research/i.test(value);

function splitExpertise(raw: string): string[] {
  if (!raw.trim() || isPlaceholder(raw)) return [];
  return raw
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isPlaceholder(s));
}

/** Some rows pack several departments into one cell separated by " / ". */
function splitDepartments(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(" / ").map((s) => s.trim()).filter(Boolean);
}

interface DeptAccumulator {
  name: string;
  facultyExpertise: string[];
}

async function embedWithBackoff(text: string, label: string): Promise<number[] | null> {
  let delayMs = 5_000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await embedText(text);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("429")) {
        console.warn(`  skipped ${label}: ${message.slice(0, 90)}`);
        return null;
      }
      if (attempt === 4) {
        console.error(`\nQUOTA EXHAUSTED at "${label}".`);
        console.error("Nothing is lost — institutions are already written.");
        console.error("Re-run `npm run seed:institutions -- --embed-only` when quota resets.\n");
        return null;
      }
      console.warn(`  rate limited, waiting ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 60_000);
    }
  }
  return null;
}

async function parseAndUpsert(files: string[], reset: boolean): Promise<void> {
  const districts = JSON.parse(readFileSync("data/districts.json", "utf8")) as DistrictCentroid[];
  const institutions = new Map<
    string,
    {
      name: string;
      state: string;
      district: string;
      type: string;
      dataDepth: string;
      departments: Map<string, DeptAccumulator>;
    }
  >();

  let rowCount = 0;
  for (const file of files) {
    const rows = parseCsv(readFileSync(file, "utf8"));
    const header = rows[0];
    if (!header) throw new Error(`${file} is empty`);
    const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

    for (const row of rows.slice(1)) {
      rowCount++;
      const name = (row[col.Institution ?? -1] ?? "").trim();
      const state = (row[col.State ?? -1] ?? "").trim();
      if (!name || !state) continue;

      const key = `${normalize(name)}|${normalize(state)}`;
      const entry = institutions.get(key) ?? {
        name,
        state,
        district: (row[col.District ?? -1] ?? "").trim(),
        type: (row[col.Type ?? -1] ?? "").trim(),
        dataDepth: (row[col.DataDepth ?? -1] ?? "").trim(),
        departments: new Map<string, DeptAccumulator>(),
      };

      const deptNames = splitDepartments(row[col.Department ?? -1] ?? "");
      const expertise = splitExpertise(row[col.ResearchAreas ?? -1] ?? "");
      for (const deptName of deptNames) {
        const dept = entry.departments.get(deptName) ?? { name: deptName, facultyExpertise: [] };
        // A packed multi-department row shares one expertise cell; spreading it
        // across all of them would credit each with expertise none was given.
        if (expertise.length > 0 && deptNames.length === 1) {
          dept.facultyExpertise = [...new Set([...dept.facultyExpertise, ...expertise])];
        }
        entry.departments.set(deptName, dept);
      }
      institutions.set(key, entry);
    }
  }

  const fuzzyLog: string[] = [];
  const unresolved: string[] = [];
  const docs = [];

  for (const entry of institutions.values()) {
    const centroid = resolveDistrict(districts, entry.state, entry.district, fuzzyLog);
    if (!centroid) {
      unresolved.push(`${entry.district}, ${entry.state}`);
      continue;
    }

    const departments = [...entry.departments.values()];
    const type = (INSTITUTION_TYPE_ENUM as readonly string[]).includes(entry.type)
      ? entry.type
      : "college";
    const dataDepth = (DATA_DEPTH_ENUM as readonly string[]).includes(entry.dataDepth)
      ? entry.dataDepth
      : departments.length > 0
        ? "deep"
        : "shallow";

    // AI_ENGINE.md §2, including the shallow fallback so an institution with
    // no department data embeds as more than a bare proper noun.
    const capabilityText =
      departments.length > 0
        ? `${entry.name} — ${departments
            .map((d) =>
              d.facultyExpertise.length > 0 ? `${d.name}: ${d.facultyExpertise.join(", ")}` : d.name,
            )
            .join("; ")}`
        : `${entry.name} — ${type.replace(/_/g, " ")} in ${centroid.district}, ${centroid.state}`;

    docs.push({
      name: entry.name,
      type,
      state: centroid.state,
      district: centroid.district,
      // ⚠ [lng, lat]. The CSV has no coordinates, so an institution sits at its
      // district centroid — the same ±10-20km tradeoff already accepted for
      // problems, and it only feeds the distance penalty in routing.
      location: {
        type: "Point" as const,
        coordinates: [centroid.lng, centroid.lat] as [number, number],
      },
      dataDepth,
      departments: departments.map((d) => ({
        name: d.name,
        facultyExpertise: d.facultyExpertise,
        embedding: [] as number[],
        activeProjectCount: 0,
      })),
      capabilityText,
      capabilityEmbedding: [] as number[],
      contactEmail: null,
      verifiedDomain: null,
    });
  }

  console.log(`parsed ${rowCount} rows -> ${institutions.size} institutions`);
  if (fuzzyLog.length > 0) {
    console.log(`\ndistrict names resolved loosely (check these):`);
    for (const line of fuzzyLog) console.log(`  ${line}`);
  }
  if (unresolved.length > 0) {
    console.warn(`\nUNRESOLVED districts — institutions skipped:`);
    for (const d of unresolved) console.warn(`  ${d}`);
  }

  if (reset) {
    const { deletedCount } = await Institution.deleteMany({});
    console.log(`\n--reset: removed ${deletedCount} existing institutions`);
  }

  for (const doc of docs) {
    // $setOnInsert for the vectors so a re-run never wipes embeddings that
    // phase 2 already paid for.
    const { capabilityEmbedding, departments, ...rest } = doc;
    const existing = await Institution.findOne({ name: doc.name, state: doc.state })
      .select("capabilityEmbedding departments")
      .lean();

    await Institution.findOneAndUpdate(
      { name: doc.name, state: doc.state },
      {
        ...rest,
        capabilityEmbedding: existing?.capabilityEmbedding?.length
          ? existing.capabilityEmbedding
          : capabilityEmbedding,
        departments: departments.map((d) => {
          const prior = existing?.departments?.find((p) => p.name === d.name);
          return prior?.embedding?.length ? { ...d, embedding: prior.embedding } : d;
        }),
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  const deep = docs.filter((d) => d.dataDepth === "deep").length;
  console.log(`\nwrote ${docs.length} institutions (${deep} deep, ${docs.length - deep} shallow)`);
}

async function embedMissing(): Promise<void> {
  const pending = await Institution.find({
    $or: [{ capabilityEmbedding: { $size: 0 } }, { "departments.embedding": { $size: 0 } }],
  }).select("name capabilityText capabilityEmbedding departments");

  if (pending.length === 0) {
    console.log("\nall institutions already embedded — nothing to do");
    return;
  }

  console.log(`\nembedding ${pending.length} institution(s) still missing vectors...`);
  let done = 0;
  let failed = 0;

  for (const inst of pending) {
    let changed = false;

    if (inst.capabilityEmbedding.length === 0) {
      const vector = await embedWithBackoff(inst.capabilityText, inst.name);
      if (!vector) {
        failed++;
        break; // quota is gone; stop rather than hammering
      }
      inst.capabilityEmbedding = vector;
      changed = true;
    }

    for (const dept of inst.departments) {
      if (dept.embedding.length > 0) continue;
      const text =
        dept.facultyExpertise.length > 0
          ? `${dept.name}: ${dept.facultyExpertise.join(", ")}`
          : dept.name;
      const vector = await embedWithBackoff(text, `${inst.name} / ${dept.name}`);
      if (!vector) {
        failed++;
        break;
      }
      dept.embedding = vector;
      changed = true;
    }

    if (changed) await inst.save();
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${pending.length}`);
    if (failed > 0) break;
  }

  const remaining = await Institution.countDocuments({ capabilityEmbedding: { $size: 0 } });
  console.log(`\nembedded ${done} institution(s); ${remaining} still without a capability vector`);
  if (remaining > 0) {
    console.log("Re-run `npm run seed:institutions -- --embed-only` when quota resets.");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");
  const embedOnly = args.includes("--embed-only");
  const files = args.filter((a) => !a.startsWith("--"));

  if (!embedOnly && files.length === 0) {
    console.error("usage: npm run seed:institutions -- <file.csv> [more.csv] [--reset] [--embed-only]");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI!, { bufferCommands: false });
  if (!embedOnly) await parseAndUpsert(files, reset);
  await embedMissing();
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
