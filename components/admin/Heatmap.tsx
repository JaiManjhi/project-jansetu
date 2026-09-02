"use client";

import { useEffect, useRef, useState } from "react";
import { MapLibreMap, type GeoJSONSource, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Problem-density heatmap — DESIGN.md §8, admin.
 *
 * Two layers on purpose. The heat layer answers "where is the volume", which
 * is the question at national zoom. The circle layer takes over as you zoom
 * in, because a heat blob cannot show data quality — and DESIGN.md §8 asks
 * specifically that GPS-verified and manually-placed points be distinguishable
 * without opening every record. Manual points are drawn hollow.
 */

function isGeoJsonSource(source: unknown): source is GeoJSONSource {
  return (
    typeof source === "object" &&
    source !== null &&
    "setData" in source &&
    typeof (source as { setData: unknown }).setData === "function"
  );
}

export interface HeatPoint {
  lat: number;
  lng: number;
  weight: number;
  locationSource: "gps" | "manual" | null;
  district?: string;
  state?: string;
}

export function Heatmap({ points }: { points: HeatPoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    setWorkerUrl("/maplibre-gl-worker.mjs");

    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      // Framed on India, since the point of this screen is national spread.
      center: [82.0, 22.5],
      zoom: 3.6,
      attributionControl: { compact: true },
    });

    map.on("load", () => {
      map.addSource("problems", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "problems-heat",
        type: "heatmap",
        source: "problems",
        maxzoom: 9,
        /**
         * Tuned for SPARSE national data, which is what this actually shows.
         *
         * The textbook heatmap settings assume thousands of clustered points:
         * a weight ramp starting at 0, and a colour ramp that stays
         * transparent until density is high. Against ~150 problems spread over
         * a country, every point lands near the bottom of both ramps and the
         * layer renders invisibly — the data was correct and the map looked
         * empty. Floors matter more than ceilings here: one lone report must
         * still draw something.
         */
        paint: {
          // A single report (weight 1) already carries real weight; more
          // reports deepen it rather than being the only way to be seen.
          "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 1, 0.55, 12, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 2, 9, 3],
          // Ramps to the accent, not a rainbow — DESIGN.md's palette holds here.
          // Only true zero is transparent; the first real stop is already visible.
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(193,87,31,0)",
            0.05, "rgba(233,180,140,0.55)",
            0.25, "rgba(224,150,100,0.7)",
            0.5, "rgba(206,113,58,0.82)",
            0.75, "rgba(180,80,30,0.9)",
            1, "rgba(140,52,14,0.95)",
          ],
          // Wider at national zoom so scattered districts read as regions.
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 18, 5, 26, 9, 34],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 7, 0.9, 9, 0.35],
        },
      });

      map.addLayer({
        id: "problems-points",
        type: "circle",
        source: "problems",
        minzoom: 6,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 14, 9],
          // Filled = GPS-verified. Hollow = manually placed.
          "circle-color": [
            "case",
            ["==", ["get", "locationSource"], "gps"], "#C1571F",
            "rgba(255,255,255,0.9)",
          ],
          "circle-stroke-color": "#C1571F",
          "circle-stroke-width": 1.5,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 8, 0.85],
          "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 8, 1],
        },
      });

      mapRef.current = map;
      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Push data whenever it changes, without rebuilding the map.
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource("problems");

    /**
     * Structural check, not `instanceof`.
     *
     * `instanceof GeoJSONSource` looked tidier and silently returned false —
     * class identity is not reliable across the bundle boundary, so the guard
     * failed closed and the map rendered empty with correct data behind it and
     * no error anywhere. A capability check cannot fail that way, and the warn
     * means a future breakage is visible instead of invisible.
     */
    if (!isGeoJsonSource(source)) {
      console.warn("[heatmap] problems source missing or not a GeoJSON source; points not drawn");
      return;
    }

    source.setData({
      type: "FeatureCollection",
      features: points.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: {
          weight: p.weight,
          locationSource: p.locationSource ?? "unknown",
          district: p.district ?? "",
        },
      })),
    });
  }, [points, ready]);

  return (
    <div>
      <div
        ref={containerRef}
        className="h-[28rem] w-full overflow-hidden rounded-card border border-border"
        role="application"
        aria-label={`Heatmap of ${points.length} reported problems across India`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-600">
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-accent" aria-hidden />
          GPS-verified location
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-accent bg-surface" aria-hidden />
          Placed manually
        </span>
        <span className="text-ink-300">Individual points appear as you zoom in.</span>
      </div>
    </div>
  );
}
