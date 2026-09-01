"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
// maplibre-gl v6 is pure ESM with NAMED exports only — the default export was
// removed, so `import maplibregl from "maplibre-gl"` (what most tutorials
// still show) fails to compile. MapLibreMap is their own alias for Map,
// avoiding a collision with the global Map constructor.
import { MapLibreMap, Marker, setWorkerUrl, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, MapPin, LoaderCircle } from "lucide-react";

/**
 * Location capture — DESIGN.md §8, the Zomato/Swiggy pattern specifically.
 *
 * Three rules from the doc, all load-bearing:
 *  1. Request GPS IMMEDIATELY on mount and pre-fill the pin the moment it
 *     resolves. Do not wait for a tap.
 *  2. "Set location manually" is EQUALLY prominent, sitting beside the pin —
 *     not buried in a menu, not revealed only after GPS fails. It covers
 *     reporting for someone else, reporting a remembered place, and GPS drift
 *     in dense or hilly terrain.
 *  3. Always show which path was used, so neither the citizen nor the data is
 *     ever ambiguous about it.
 */

export interface LocationValue {
  lat: number;
  lng: number;
  source: "gps" | "manual";
  accuracyM: number | null;
}

interface LocationPickerProps {
  value: LocationValue | null;
  onChange: (value: LocationValue) => void;
}

// Centre of India, used only as an initial camera before GPS resolves.
const FALLBACK_CENTER = { lat: 23.0, lng: 82.0 };

type GpsState = "idle" | "locating" | "ok" | "denied" | "unavailable";

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  // Starts at "locating" because the effect below requests GPS on mount —
  // so the mount path never needs a synchronous setState to get there.
  const [gps, setGps] = useState<GpsState>("locating");

  /**
   * Whether the browser has geolocation at all. Read as a snapshot rather than
   * held in state: it never changes, and making it state meant `locate()`
   * carried a synchronous setState that React flags when called from the mount
   * effect. Server snapshot is `true` so the first paint shows "Finding your
   * location…" rather than briefly claiming it is unavailable.
   */
  const hasGeolocation = useSyncExternalStore(
    () => () => {},
    () => "geolocation" in navigator,
    () => true,
  );

  // Kept in a ref so the map's event handler always sees the latest callback
  // without needing to tear down and rebuild the map.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // --- map bootstrap (once) ------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Point MapLibre at a worker served from /public. Turbopack cannot resolve
    // the URL maplibre builds internally, so the request returns Next's HTML
    // shell and the browser rejects it on MIME type. MapLibre then silently
    // falls back to the main thread — the map still renders, which is what
    // makes this easy to miss. scripts/sync-map-worker.mjs keeps the copy in
    // step with the installed version.
    setWorkerUrl("/maplibre-gl-worker.mjs");

    const map = new MapLibreMap({
      container: containerRef.current,
      // Raster OSM tiles: no API key, no cost (ARCHITECTURE.md §3).
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
      center: [FALLBACK_CENTER.lng, FALLBACK_CENTER.lat],
      zoom: 3.5,
      attributionControl: { compact: true },
    });

    const marker = new Marker({ color: "#C1571F", draggable: true })
      .setLngLat([FALLBACK_CENTER.lng, FALLBACK_CENTER.lat])
      .addTo(map);

    // Dragging the pin is itself the "manual" path — no mode switch needed.
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLngLat();
      onChangeRef.current({ lat, lng, source: "manual", accuracyM: null });
    });

    // Tapping the map moves the pin too; on a phone that is the natural gesture.
    map.on("click", (event: MapMouseEvent) => {
      const { lat, lng } = event.lngLat;
      marker.setLngLat([lng, lat]);
      onChangeRef.current({ lat, lng, source: "manual", accuracyM: null });
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // The bare geolocation call, with no synchronous state change, so it is
  // safe to invoke directly from the mount effect.
  const locate = useCallback(() => {
    // No setState on this path — see hasGeolocation above.
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setGps("ok");
        mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 15, duration: 800 });
        markerRef.current?.setLngLat([longitude, latitude]);
        onChangeRef.current({
          lat: latitude,
          lng: longitude,
          source: "gps",
          accuracyM: Math.round(accuracy),
        });
      },
      (error) => setGps(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, []);

  // Setting "locating" is correct in an event handler, just not in an effect.
  const requestGps = useCallback(() => {
    setGps("locating");
    locate();
  }, [locate]);

  // Rule 1: fire immediately on mount, do not wait for a tap.
  useEffect(() => {
    locate();
  }, [locate]);

  return (
    <div>
      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-card border border-border"
        // The map is a supporting control; the text state below is the
        // authoritative, screen-reader-legible answer.
        role="application"
        aria-label="Map showing the reported problem's location. Drag the pin to move it."
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {/* Rule 2: both paths, side by side, equal weight. */}
        <button
          type="button"
          onClick={requestGps}
          className="inline-flex min-h-touch items-center gap-2 rounded-button border border-border bg-surface px-4 text-base font-medium text-ink-900 transition-colors hover:bg-accent-subtle"
        >
          {gps === "locating" ? (
            <LoaderCircle size={20} strokeWidth={1.5} className="animate-spin" aria-hidden />
          ) : (
            <Crosshair size={20} strokeWidth={1.5} aria-hidden />
          )}
          Use my current location
        </button>

        <span className="inline-flex min-h-touch items-center gap-2 rounded-button border border-border bg-surface px-4 text-base font-medium text-ink-900">
          <MapPin size={20} strokeWidth={1.5} aria-hidden />
          Or drag the pin to set it manually
        </span>
      </div>

      {/* Rule 3: never ambiguous which path produced this coordinate. */}
      <p className="mt-3 text-sm" role="status">
        {value === null && gps === "locating" && (
          <span className="text-ink-600">Finding your location…</span>
        )}
        {value === null && gps === "denied" && (
          <span className="text-warning">
            Location access was blocked. Drag the pin on the map to set it manually.
          </span>
        )}
        {value === null && !hasGeolocation && (
          <span className="text-warning">
            Could not get your location. Drag the pin on the map to set it manually.
          </span>
        )}
        {value?.source === "gps" && (
          <span className="text-success">
            Using your current location
            {value.accuracyM !== null && ` — accurate to about ${value.accuracyM}m`}
          </span>
        )}
        {value?.source === "manual" && (
          <span className="text-ink-600">Location set manually</span>
        )}
      </p>
    </div>
  );
}
