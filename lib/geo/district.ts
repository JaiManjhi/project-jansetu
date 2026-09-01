import districtsData from "../../data/districts.json" with { type: "json" };
import { haversineKm } from "./haversine.ts";

export interface DistrictCentroid {
  district: string;
  state: string;
  lat: number;
  lng: number;
}

/**
 * 789 districts across all 36 states and union territories, built from
 * district boundary polygons by scripts/build-districts.mts.
 */
const DISTRICTS: readonly DistrictCentroid[] =
  districtsData as DistrictCentroid[];

export interface ResolvedDistrict {
  district: string;
  state: string;
  /** Distance to the matched centroid. Large values mean a coastal or
   *  offshore point, or coordinates outside India entirely. */
  distanceKm: number;
}

/**
 * India's bounding box, generously padded. Anything outside is not a
 * plausible submission and almost always means swapped lat/lng.
 */
const INDIA_BOUNDS = { minLat: 6, maxLat: 38, minLng: 68, maxLng: 98 };

export function isWithinIndia(lat: number, lng: number): boolean {
  return (
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lng >= INDIA_BOUNDS.minLng &&
    lng <= INDIA_BOUNDS.maxLng
  );
}

/**
 * Resolves {lat, lng} to the district whose centroid is nearest.
 *
 * DATA_MODEL.md, "Deriving district and state" — this is the ONLY way
 * problems.district and problems.state are ever set. They are never accepted
 * from the client, because a client-supplied district that disagrees with the
 * coordinates silently splits dedup buckets.
 *
 * A linear scan over 789 entries is a few hundred microseconds, which is
 * nothing against the ~600ms embedding call that follows it. No spatial index
 * is warranted, and a wrong one would be a real source of bugs.
 *
 * Nearest-centroid, not point-in-polygon: a point within roughly 10-20km of a
 * district border can resolve to its neighbour. That is accepted — dedup needs
 * *deterministic* bucketing far more than it needs cartographic accuracy, and
 * the same hand pump reported twice always lands in the same bucket either way.
 */
export function resolveDistrict(lat: number, lng: number): ResolvedDistrict {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`resolveDistrict received non-finite coordinates: ${lat}, ${lng}`);
  }

  let best: DistrictCentroid | null = null;
  let bestKm = Infinity;

  for (const d of DISTRICTS) {
    const km = haversineKm(lat, lng, d.lat, d.lng);
    if (km < bestKm) {
      bestKm = km;
      best = d;
    }
  }

  if (!best) {
    // Only reachable if the data file is empty, which the build script's
    // bounding-box check should have prevented.
    throw new Error("district table is empty — rebuild data/districts.json");
  }

  return {
    district: best.district,
    state: best.state,
    distanceKm: Math.round(bestKm * 100) / 100,
  };
}

/**
 * Converts the API's human-friendly {lat, lng} into MongoDB's GeoJSON Point.
 *
 * ⚠ GeoJSON is [lng, lat] — the reverse of how coordinates are spoken, written
 * and passed around in the request body. API_SPEC.md flags this as the
 * project's canonical silent bug: get it backwards and every submission still
 * saves, still reads back, and still renders — just in the wrong place. There
 * is no error to notice.
 *
 * Every write to problems.location and institutions.location goes through
 * here. Do not hand-build the array at a call site.
 */
export function toGeoPoint(
  lat: number,
  lng: number,
): { type: "Point"; coordinates: [number, number] } {
  return { type: "Point", coordinates: [lng, lat] };
}
