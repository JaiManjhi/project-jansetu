const EARTH_RADIUS_KM = 6371;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance in kilometres between two {lat, lng} points.
 *
 * Used in two places with different jobs: picking the nearest district
 * centroid (lib/geo/district.ts) and scoring institution proximity in routing
 * (AI_ENGINE.md §4). Straight-line distance is an accepted proxy for both —
 * neither needs road distance, and avoiding a routing API keeps the submit
 * path free of network calls.
 */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
