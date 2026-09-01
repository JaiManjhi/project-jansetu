/**
 * Builds data/districts.json — the district centroid table used by
 * lib/geo/district.ts to resolve {lat,lng} → {district, state}.
 *
 * This is a ONE-TIME build step, not part of the app. It reads a district
 * boundary GeoJSON and reduces each district's polygons to a single
 * area-weighted centroid, turning ~78MB of boundary data into ~60KB.
 *
 * Usage:
 *   1. Download the source (77,828,927 bytes, not committed — too large):
 *      curl -L -o <somewhere>/INDIA_DISTRICTS.geojson \
 *        https://raw.githubusercontent.com/datta07/INDIAN-SHAPEFILES/master/INDIA/INDIA_DISTRICTS.geojson
 *   2. node scripts/build-districts.mts <path-to-geojson>
 *
 * Why centroids and not the polygons themselves: see DATA_MODEL.md,
 * "Deriving district and state". Short version — dedup needs deterministic
 * bucketing far more than it needs cartographic accuracy, and a 60KB lookup
 * with no network dependency cannot fail on demo day.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Ring = number[][];
type PolygonCoords = Ring[];
type MultiPolygonCoords = PolygonCoords[];

interface Feature {
  properties: Record<string, unknown>;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: PolygonCoords | MultiPolygonCoords;
  } | null;
}

interface DistrictEntry {
  district: string;
  state: string;
  lat: number;
  lng: number;
}

/**
 * Shoelace centroid of a single ring, in degrees.
 *
 * Working in raw lon/lat rather than projecting is a deliberate
 * simplification: across one Indian district the distortion is far below the
 * ~10-20km border error already accepted for nearest-centroid bucketing, and
 * projecting would add a dependency for no behavioural gain.
 *
 * Returns null for degenerate rings (zero area), which do occur in this
 * source — they must be skipped, not divided by.
 */
function ringCentroid(
  ring: Ring,
): { lng: number; lat: number; area: number } | null {
  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    if (
      typeof xi !== "number" ||
      typeof yi !== "number" ||
      typeof xj !== "number" ||
      typeof yj !== "number"
    ) {
      continue;
    }
    const cross = xj * yi - xi * yj;
    twiceArea += cross;
    x += (xj + xi) * cross;
    y += (yj + yi) * cross;
  }

  if (twiceArea === 0) return null;
  const area = twiceArea / 2;
  return { lng: x / (6 * area), lat: y / (6 * area), area: Math.abs(area) };
}

/**
 * Source artifacts that are not districts. Excluded here rather than by hand-
 * editing data/districts.json, so a rebuild stays reproducible.
 *
 * Each of these would otherwise become a live bucket: a coastal Gujarat report
 * could snap to "Island", and a Delhi report to "Nazul", splitting dedup for
 * a real district across a fictional neighbour.
 */
const EXCLUDE: ReadonlyArray<{ state: string; district: string; why: string }> =
  [
    {
      state: "Gujarat and Dnh & Dd Islands",
      district: "Island",
      why: "unnamed island grouping in the Gulf of Kutch; not a district, and its state label is a source artifact",
    },
    {
      state: "Delhi",
      district: "Nazul",
      why: "'Nazul' is a land-tenure category, not one of Delhi's 11 districts",
    },
  ];

/**
 * The source encodes diacritics as ASCII punctuation — a legacy-encoding
 * artifact, not real names. 51 of 789 districts are affected, including
 * Kolkata ("Kolk>ta"), Mysuru ("Mys#ru") and Dehradun ("Dehrad@n").
 *
 * Decoded by cross-checking every affected name against its real spelling:
 *   >  →  a   (Kolk>ta = Kolkāta, B>nkura = Bānkura)
 *   |  →  i   (Ham|rpur = Hamīrpur)
 *   @  →  u   (Dehrad@n = Dehradūn)
 *   #  →  u   (Mys#ru = Mysūru, Bengal#ru = Bengalūru)
 *   \  →  i   (B\dar = Bīdar)
 *   _  →  -   (Medchal_malkajgiri = Medchal-Malkajgiri)
 *
 * We deliberately fold to unaccented ASCII rather than restoring the
 * diacritics: these names are matched, displayed and logged all over the app,
 * and plain ASCII avoids a second class of encoding bug later.
 */
const CHAR_FIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/>/g, "a"],
  [/\|/g, "i"],
  [/@/g, "u"],
  [/#/g, "u"],
  [/\\/g, "i"],
  [/_/g, "-"],
];

function repairEncoding(raw: string): string {
  let s = raw;
  for (const [pattern, replacement] of CHAR_FIXES) s = s.replace(pattern, replacement);
  return s;
}

function titleCase(raw: string): string {
  // Capitalise after a space, a hyphen, or an opening parenthesis, so
  // "saraikela-kharsawan" and "bengaluru (rural)" come out right.
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === "and" ? w : w.replace(/(^|[-(])([a-z])/g, (_m, p, c) => p + c.toUpperCase())))
    .join(" ")
    .replace(/^and\b/, "And");
}

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node scripts/build-districts.mts <path-to-geojson>");
    process.exit(1);
  }

  console.log(`reading ${input} ...`);
  const parsed: unknown = JSON.parse(readFileSync(input, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { features?: unknown }).features)
  ) {
    throw new Error("input is not a GeoJSON FeatureCollection");
  }
  const features = (parsed as { features: Feature[] }).features;
  console.log(`features: ${features.length}`);

  // A district can appear as several features and as multi-part polygons, so
  // accumulate an area-weighted mean rather than taking the first one.
  const acc = new Map<
    string,
    { district: string; state: string; sx: number; sy: number; sw: number }
  >();

  let skippedNoGeometry = 0;
  let skippedDegenerate = 0;

  for (const f of features) {
    const districtRaw = f.properties?.district;
    const stateRaw = f.properties?.state;
    if (typeof districtRaw !== "string" || typeof stateRaw !== "string") {
      skippedNoGeometry++;
      continue;
    }
    if (!f.geometry) {
      skippedNoGeometry++;
      continue;
    }

    const polygons: PolygonCoords[] =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates as PolygonCoords]
        : (f.geometry.coordinates as MultiPolygonCoords);

    const district = titleCase(repairEncoding(districtRaw));
    const state = titleCase(repairEncoding(stateRaw));
    const key = `${state}|${district}`;
    const entry = acc.get(key) ?? {
      district,
      state,
      sx: 0,
      sy: 0,
      sw: 0,
    };

    for (const poly of polygons) {
      // Ring 0 is the outer boundary; later rings are holes. Holes shift a
      // centroid only slightly and are ignored deliberately.
      const outer = poly[0];
      if (!outer || outer.length < 4) {
        skippedDegenerate++;
        continue;
      }
      const c = ringCentroid(outer);
      if (!c) {
        skippedDegenerate++;
        continue;
      }
      entry.sx += c.lng * c.area;
      entry.sy += c.lat * c.area;
      entry.sw += c.area;
    }

    acc.set(key, entry);
  }

  const out: DistrictEntry[] = [];
  let excluded = 0;
  for (const e of acc.values()) {
    if (e.sw === 0) continue;
    const skip = EXCLUDE.find(
      (x) => x.state === e.state && x.district === e.district,
    );
    if (skip) {
      console.log(`excluded "${skip.district}" (${skip.state}) — ${skip.why}`);
      excluded++;
      continue;
    }
    out.push({
      district: e.district,
      state: e.state,
      lat: Number((e.sy / e.sw).toFixed(5)),
      lng: Number((e.sx / e.sw).toFixed(5)),
    });
  }

  out.sort((a, b) =>
    a.state === b.state
      ? a.district.localeCompare(b.district)
      : a.state.localeCompare(b.state),
  );

  // Every centroid must land inside India's bounding box. A failure here means
  // swapped coordinates or a bad source, and it must not reach the app.
  const outOfBounds = out.filter(
    (d) => d.lat < 6 || d.lat > 38 || d.lng < 68 || d.lng > 98,
  );
  if (outOfBounds.length > 0) {
    console.error(
      `\n${outOfBounds.length} centroid(s) outside India's bounding box:`,
    );
    for (const d of outOfBounds.slice(0, 10)) {
      console.error(`  ${d.district}, ${d.state} → ${d.lat}, ${d.lng}`);
    }
    throw new Error("refusing to write an out-of-bounds centroid table");
  }

  // Nothing may reach the app with an unrepaired encoding artifact in its
  // name — these names are displayed to citizens and matched against.
  const NAME_OK = /^[A-Za-z0-9 .'()&-]+$/;
  const badNames = out.filter(
    (d) => !NAME_OK.test(d.district) || !NAME_OK.test(d.state),
  );
  if (badNames.length > 0) {
    console.error(
      `\n${badNames.length} name(s) still contain unexpected characters:`,
    );
    for (const d of badNames.slice(0, 20)) {
      console.error(`  ${JSON.stringify(d.district)} / ${JSON.stringify(d.state)}`);
    }
    throw new Error("refusing to write unrepaired names — extend CHAR_FIXES");
  }

  const target = resolve(process.cwd(), "data/districts.json");
  writeFileSync(target, JSON.stringify(out, null, 0) + "\n");

  const states = new Set(out.map((d) => d.state));
  console.log(`\ndistricts: ${out.length}`);
  console.log(`states/UTs: ${states.size}`);
  console.log(`skipped (no geometry/props): ${skippedNoGeometry}`);
  console.log(`skipped (degenerate ring):   ${skippedDegenerate}`);
  console.log(`excluded (source artifacts): ${excluded}`);
  console.log(`wrote ${target}`);
}

main();
