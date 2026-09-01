import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineKm } from "../lib/geo/haversine.ts";
import { resolveDistrict, toGeoPoint, isWithinIndia } from "../lib/geo/district.ts";

test("haversine: known city-pair distances", () => {
  // Delhi → Mumbai is ~1150km; Ranchi → Jamshedpur ~110km.
  assert.ok(Math.abs(haversineKm(28.6139, 77.209, 19.076, 72.8777) - 1150) < 40);
  assert.ok(Math.abs(haversineKm(23.3441, 85.3096, 22.8046, 86.2029) - 110) < 20);
  assert.equal(haversineKm(23.3441, 85.3096, 23.3441, 85.3096), 0);
});

test("resolveDistrict: known coordinates land in the right district", () => {
  const cases: Array<[number, number, string, string]> = [
    [23.3441, 85.3096, "Ranchi", "Jharkhand"],
    [28.6139, 77.209, "New Delhi", "Delhi"],
    [13.0827, 80.2707, "Chennai", "Tamil Nadu"],
    [26.9124, 75.7873, "Jaipur", "Rajasthan"],
    [22.5726, 88.3639, "Kolkata", "West Bengal"],
    [12.9716, 77.5946, "Bengaluru (Urban)", "Karnataka"],
  ];
  for (const [lat, lng, district, state] of cases) {
    const got = resolveDistrict(lat, lng);
    assert.equal(got.state, state, `${lat},${lng} state`);
    assert.equal(got.district, district, `${lat},${lng} district`);
  }
});

test("resolveDistrict: deterministic — same input, same bucket", () => {
  const a = resolveDistrict(23.3441, 85.3096);
  const b = resolveDistrict(23.3441, 85.3096);
  assert.deepEqual(a, b);
  // Two reports of the same problem a few hundred metres apart must agree.
  const near = resolveDistrict(23.3465, 85.3125);
  assert.equal(near.district, a.district);
});

test("resolveDistrict: rejects non-finite coordinates", () => {
  assert.throws(() => resolveDistrict(Number.NaN, 85.3), /non-finite/);
});

test("toGeoPoint: emits [lng, lat], NOT [lat, lng]", () => {
  // The canonical silent bug from API_SPEC.md. Ranchi is lat 23.34, lng 85.31 —
  // if these ever swap, every pin lands in the wrong place with no error.
  const p = toGeoPoint(23.3441, 85.3096);
  assert.equal(p.type, "Point");
  assert.equal(p.coordinates[0], 85.3096, "coordinates[0] must be LONGITUDE");
  assert.equal(p.coordinates[1], 23.3441, "coordinates[1] must be LATITUDE");
});

test("isWithinIndia: catches swapped pairs", () => {
  assert.ok(isWithinIndia(23.3441, 85.3096));
  // The same pair swapped: lat 85.3 is outside India (and outside the tropics).
  assert.ok(!isWithinIndia(85.3096, 23.3441));
});

test("resolveDistrict: documents the near-border limitation honestly", () => {
  // Jamshedpur is in East Singhbhum, but sits close to the Saraikela-Kharsawan
  // border, so the nearest CENTROID belongs to the neighbour. This is the
  // accepted cost of centroid bucketing (DATA_MODEL.md) — asserted here so the
  // behaviour is documented and a future switch to point-in-polygon is a
  // visible, deliberate change rather than a silent one.
  const got = resolveDistrict(22.8046, 86.2029);
  assert.equal(got.state, "Jharkhand");
  assert.equal(got.district, "Saraikela-Kharsawan");

  // What actually matters for dedup: two reports of the same problem agree.
  assert.equal(resolveDistrict(22.8055, 86.2041).district, got.district);
});

test("district table: shape and coverage", async () => {
  const { default: districts } = await import("../data/districts.json", {
    with: { type: "json" },
  });
  assert.equal(districts.length, 788);
  assert.equal(new Set(districts.map((d) => d.state)).size, 36);
  for (const d of districts) {
    assert.match(d.district, /^[A-Za-z0-9 .'()&-]+$/, `bad name: ${d.district}`);
    assert.ok(d.lat >= 6 && d.lat <= 38, `lat out of range: ${d.district}`);
    assert.ok(d.lng >= 68 && d.lng <= 98, `lng out of range: ${d.district}`);
  }
});
