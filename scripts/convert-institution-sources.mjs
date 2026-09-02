/**
 * Normalises the raw institution research files into ONE canonical CSV that
 * scripts/seed-institutions.mts already understands.
 *
 *   node scripts/convert-institution-sources.mjs "<resources dir>" data/institutions.csv
 *
 * The seven source files arrived in six different shapes: columns in different
 * orders, headers on different rows, section-divider rows inside the data, a
 * Word table, and one table where the institution and state are concatenated
 * with no separator ("IIT KharagpurWest Bengal"). Rather than teach the seeder
 * six formats, each is mapped here into the canonical eight columns.
 *
 * Output columns:
 *   Institution, State, District, Type, DataDepth, Department,
 *   ResearchAreas, SourceVerified
 *
 * NOTHING is silently dropped. Any row whose district cannot be resolved is
 * printed at the end, because an institution quietly missing from the map is
 * far worse than one that is loudly missing from the output.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------- xlsx/docx

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, "&");

function unzipTo(file) {
  const dir = mkdtempSync(join(tmpdir(), "jansetu-src-"));
  execFileSync("unzip", ["-o", "-q", file, "-d", dir]);
  return dir;
}

function colIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Reads sheet1 of an xlsx as an array of string arrays. */
function readXlsx(file) {
  const dir = unzipTo(file);
  let shared = [];
  const sharedPath = join(dir, "xl", "sharedStrings.xml");
  if (existsSync(sharedPath)) {
    const xml = readFileSync(sharedPath, "utf8");
    shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
    );
  }
  const xml = readFileSync(join(dir, "xl", "worksheets", "sheet1.xml"), "utf8");
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of rowMatch[1].matchAll(/<c( [^>]*)?>([\s\S]*?)<\/c>|<c( [^>]*)?\/>/g)) {
      const attrs = c[1] ?? c[3] ?? "";
      const inner = c[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") {
        value = decodeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      } else if (type === "s") {
        value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? -1)] ?? "";
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      }
      const at = ref ? colIndex(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** Reads every table row of a .docx as an array of cell arrays. */
function readDocxTables(file) {
  const dir = unzipTo(file);
  const xml = readFileSync(join(dir, "word", "document.xml"), "utf8");
  return [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((row) =>
    [...row[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((cell) =>
      // `<w:t(?: [^>]*)?>` and not `<w:t[^>]*>` — the latter also matches
      // <w:tbl> and <w:tc>, which drags raw table markup into the text.
      decodeXml(
        [...cell[0].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join(""),
      ).trim(),
    ),
  );
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ------------------------------------------------------------------ mapping

const STATES = [
  "Jharkhand", "Bihar", "Odisha", "West Bengal", "Chhattisgarh", "Madhya Pradesh",
  "Uttar Pradesh", "Delhi", "Karnataka", "Haryana", "Maharashtra", "Rajasthan",
];

/**
 * City → district, for cities whose district has a different name.
 *
 * None of these sources carry a district; they carry a city, or only the city
 * embedded in the institution's own name. A district is required — dedup and
 * the heatmap both key on it — so it has to be derived, and derived visibly.
 * Only entries where city ≠ district are listed; anything else resolves by
 * name through the seeder's own matcher.
 */
const CITY_TO_DISTRICT = {
  jamshedpur: "East Singhbhum",
  sindri: "Dhanbad",
  mesra: "Ranchi",
  kharagpur: "Paschim Medinipur",
  jadavpur: "Kolkata",
  durgapur: "Paschim Barddhaman",
  rourkela: "Sundargarh",
  bhubaneswar: "Khordha",
  kanpur: "Kanpur Nagar",
  allahabad: "Prayagraj",
  "greater noida": "Gautam Buddha Nagar",
  bangalore: "Bengaluru (Urban)",
  bengaluru: "Bengaluru (Urban)",
  sonipat: "Sonipat",
  delhi: "New Delhi",
  "new delhi": "New Delhi",
};

/** Cities that appear inside institution names, longest first so
 *  "Greater Noida" wins over "Noida". */
const CITY_HINTS = [
  "Greater Noida", "New Delhi", "Bhubaneswar", "Jamshedpur", "Kharagpur", "Allahabad",
  "Bengaluru", "Bangalore", "Durgapur", "Rourkela", "Jadavpur", "Bhagalpur", "Varanasi",
  "Dhanbad", "Gwalior", "Bhopal", "Indore", "Ujjain", "Sehore", "Ranchi", "Raipur",
  "Raigarh", "Kanpur", "Lucknow", "Sindri", "Mesra", "Patna", "Satna", "Guna", "Delhi",
];

/**
 * Canonical institution names.
 *
 * The same institution appears across sources under different names — "BIT
 * Mesra", "BIT Mesra, Ranchi" and "BIT Mesra (Ranchi)" are one place, and
 * "NIT Raipur" is "National Institute of Technology Raipur". The seeder groups
 * by name, so leaving these apart would split one institution into three
 * records each holding a fraction of its departments. That is worse than
 * having fewer institutions: routing would see three thin profiles instead of
 * one strong one, which is exactly the weakness this data was meant to fix.
 *
 * Keyed by the normalised form (lowercase, alphanumerics only).
 */
const NAME_CANONICAL = {
  bitmesra: "BIT Mesra, Ranchi",
  bitmesraranchi: "BIT Mesra, Ranchi",
  centraluniversityofjharkhand: "Central University of Jharkhand",
  centraluniversityofjharkhandcuj: "Central University of Jharkhand",
  xissranchi: "XISS, Ranchi",
  nitraipur: "National Institute of Technology Raipur",
  nationalinstituteoftechnologyraipur: "National Institute of Technology Raipur",
  birsaagriculturaluniversity: "Birsa Agricultural University",
  birsaagriculturaluniversitybauranchi: "Birsa Agricultural University",
  niffranchi: "NIFFT Ranchi",
  nifftranchi: "NIFFT Ranchi",
  sisterniveditauniversitysnu: "Sister Nivedita University",
  shivnadaruniversitysnu: "Shiv Nadar University",
  opjindaluniversityopju: "O.P. Jindal University",
  soauniversityiter: "SOA University (ITER)",
  kiitdeemedtobeuniversity: "KIIT University",
};

const canonicalName = (raw) => {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return NAME_CANONICAL[key] ?? raw.trim();
};

const INSTITUTION_DISTRICT_OVERRIDES = {
  // Jharkhand institutions whose names carry no city. This is the origin state
  // for the problem statement, so leaving any of these unplaced is not an option.
  "central university of jharkhand": "Ranchi",
  "birsa agricultural university": "Ranchi",
  "usha martin university": "Ranchi",
  "sarala birla university": "Ranchi",
  "amity university jharkhand": "Ranchi",
  "jharkhand rai university": "Ranchi",
  "arka jain university": "East Singhbhum",
  "icfai university jharkhand": "Ranchi",
  "nifft ranchi": "Ranchi",
  // Named for an institute, not a place, or the place is not in the name.
  "csir-cimfr": "Dhanbad",
  "csir-nml": "East Singhbhum",
  "nifft ranchi": "Ranchi",
  "o.p. jindal university (opju)": "Raigarh",
  "o.p. jindal global university": "Sonipat",
  "ashoka university": "Sonipat",
  "shiv nadar university (snu)": "Gautam Buddha Nagar",
  "iiit bhagalpur": "Bhagalpur",
  "iit (bhu) varanasi": "Varanasi",
  "sister nivedita university (snu)": "Kolkata",
  "jis university": "Kolkata",
  "gopal narayan singh university": "Rohtas",
  "kiit deemed to be university": "Khordha",
  "soa university (iter)": "Khordha",
  "vit bhopal university": "Sehore",
  "malwanchal university": "Indore",
  "avantika university": "Ujjain",
  "aks university": "Satna",
};

function resolveDistrict(institution, state, cityColumn) {
  const key = institution.toLowerCase().trim();
  if (INSTITUTION_DISTRICT_OVERRIDES[key]) return INSTITUTION_DISTRICT_OVERRIDES[key];

  const city = (cityColumn || "").split("/")[0].trim();
  if (city) {
    const mapped = CITY_TO_DISTRICT[city.toLowerCase()];
    if (mapped) return mapped;
    return city; // the seeder's own matcher handles spelling variants
  }

  for (const hint of CITY_HINTS) {
    if (new RegExp(`\\b${hint}\\b`, "i").test(institution)) {
      return CITY_TO_DISTRICT[hint.toLowerCase()] ?? hint;
    }
  }
  return null;
}

/** "IIT KharagpurWest Bengal" -> ["IIT Kharagpur", "West Bengal"]. */
function splitTrailingState(value) {
  for (const state of STATES) {
    if (value.endsWith(state) && value.length > state.length) {
      return [value.slice(0, -state.length).trim(), state];
    }
  }
  if (value.endsWith("Delhi NCR")) return [value.slice(0, -"Delhi NCR".length).trim(), "Delhi"];
  return [value, ""];
}

function classifyType(institution, category = "") {
  const text = `${institution} ${category}`.toLowerCase();
  if (/\buniversity|vishwavidyalaya|vishwavidyalya\b/.test(text)) return "university";
  if (/\biit|nit|iiit|iim|institute of technology|polytechnic|technical\b/.test(text)) {
    return "technical_institute";
  }
  return "college";
}

const csvEscape = (v) => {
  const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// --------------------------------------------------------------------- main

const resourcesDir = process.argv[2];
const outFile = process.argv[3] ?? "data/institutions.csv";
if (!resourcesDir) {
  console.error('usage: node scripts/convert-institution-sources.mjs "<resources dir>" [out.csv]');
  process.exit(1);
}

const out = [];
const unresolved = [];
const at = (name) => join(resourcesDir, name);

function push({ institution, state, district, department, research, source, category }) {
  const inst = canonicalName(institution || "");
  const dept = (department || "").trim();
  if (!inst || !dept) return;
  const resolvedDistrict = district || resolveDistrict(inst, state, "");
  if (!resolvedDistrict) {
    unresolved.push(`${inst} (${state || "state unknown"})`);
    return;
  }
  out.push([
    inst,
    (state || "").trim(),
    resolvedDistrict,
    classifyType(inst, category),
    "deep",
    dept,
    (research || "").trim(),
    (source || "").trim() || "Research directory supplied by the team",
  ]);
}

// 1. The canonical CSV — already the right shape, passed through unchanged.
const realCsv = at("chhattisgarh-institutions real.csv");
if (existsSync(realCsv)) {
  const rows = parseCsv(readFileSync(realCsv, "utf8"));
  for (const r of rows.slice(1)) {
    if (!r[0]?.trim()) continue;
    out.push([canonicalName(r[0]), r[1], r[2], r[3], r[4] || "shallow", r[5] || "", r[6] || "", r[7] || ""]);
  }
  console.log(`chhattisgarh-institutions real.csv: ${rows.length - 1} rows`);
}

// 2-4. The three PS43 spreadsheets: same idea, columns in different orders.
const PS43 = [
  { file: "PS43_Institution_Research_Dataset.xlsx", inst: 1, state: 0, dept: 2, res: 3, src: 4 },
  { file: "ps_43_institution_research (1).xlsx", inst: 0, state: 1, dept: 2, res: 3, src: 4 },
  { file: "ps_43_institution_research_dataset (1).xlsx", inst: 0, state: 1, dept: 2, res: 3, src: -1 },
];
for (const spec of PS43) {
  const path = at(spec.file);
  if (!existsSync(path)) continue;
  const rows = readXlsx(path);
  let n = 0;
  for (const r of rows.slice(1)) {
    if (!r[spec.inst]?.trim()) continue;
    push({
      institution: r[spec.inst],
      state: r[spec.state],
      department: r[spec.dept],
      research: r[spec.res],
      source: spec.src >= 0 ? r[spec.src] : "",
    });
    n++;
  }
  console.log(`${spec.file}: ${n} rows`);
}

// 5-6. The two "Untitled" directories: header on row 3, section dividers inside.
const DIRECTORIES = [
  { file: "Untitled (1).xlsx", header: 2, inst: 0, place: 1, category: 2, dept: 3, res: 4, src: 5, placeIsState: true },
  { file: "Untitled.xlsx", header: 2, inst: 0, place: 1, category: 2, dept: 3, res: 4, src: 5, placeIsState: false, fixedState: "Madhya Pradesh" },
];
for (const spec of DIRECTORIES) {
  const path = at(spec.file);
  if (!existsSync(path)) continue;
  const rows = readXlsx(path);
  let n = 0;
  for (const r of rows.slice(spec.header + 1)) {
    const institution = r[spec.inst]?.trim();
    // Section dividers ("PRIMARY REGIONAL CLUSTER: JHARKHAND") occupy the
    // first cell with nothing beside them.
    if (!institution || !r[spec.dept]?.trim()) continue;
    const place = r[spec.place]?.trim() ?? "";
    const state = spec.placeIsState ? place.split("/")[0].trim() : spec.fixedState;
    const district = spec.placeIsState
      ? resolveDistrict(institution, state, "")
      : resolveDistrict(institution, state, place);
    push({
      institution,
      state: state === "Delhi NCR" ? "Delhi" : state,
      district,
      category: r[spec.category],
      department: r[spec.dept],
      research: r[spec.res],
      source: r[spec.src],
    });
    n++;
  }
  console.log(`${spec.file}: ${n} rows`);
}

// 7. The Word directory — two tables, the second with state glued to the name.
const docx = at("Target Research Institutions & Faculty Directory.docx");
if (existsSync(docx)) {
  const rows = readDocxTables(docx);
  let n = 0;
  for (const r of rows) {
    const first = r[0]?.trim();
    if (!first || !r[1]?.trim() || /^institution/i.test(first)) continue;
    const [institution, trailingState] = splitTrailingState(first);
    push({
      institution,
      // The first table is the Jharkhand cluster and states no state at all.
      state: trailingState || "Jharkhand",
      department: r[1],
      research: r[2],
      source: "Target Research Institutions & Faculty Directory",
    });
    n++;
  }
  console.log(`Target Research Institutions & Faculty Directory.docx: ${n} rows`);
}

const header = "Institution,State,District,Type,DataDepth,Department,ResearchAreas,SourceVerified";
writeFileSync(outFile, [header, ...out.map((r) => r.map(csvEscape).join(","))].join("\n") + "\n");

const institutions = new Set(out.map((r) => `${r[0]}|${r[1]}`));
const deep = out.filter((r) => r[4] === "deep").length;
console.log(`\nwrote ${outFile}`);
console.log(`  rows: ${out.length} (${deep} deep, ${out.length - deep} shallow)`);
console.log(`  distinct institutions: ${institutions.size}`);
console.log(`  states: ${new Set(out.map((r) => r[1]).filter(Boolean)).size}`);
if (unresolved.length > 0) {
  console.warn(`\nCOULD NOT RESOLVE A DISTRICT for ${unresolved.length} row(s) — add them to`);
  console.warn(`INSTITUTION_DISTRICT_OVERRIDES or CITY_HINTS in this script:`);
  for (const u of [...new Set(unresolved)]) console.warn(`  ${u}`);
}
