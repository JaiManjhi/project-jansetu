/**
 * Copies MapLibre's worker bundle into public/ so it is served as a real
 * JavaScript module.
 *
 * Why this is needed: maplibre-gl v6 spawns its worker with
 * `new Worker(new URL(...), {type:"module"})`. Turbopack does not resolve that
 * URL, so the request falls through to Next's catch-all and returns the HTML
 * app shell — the browser then refuses it with "Failed to load module script:
 * non-JavaScript MIME type". MapLibre degrades to the main thread, so raster
 * tiles still render and nothing looks broken, which is precisely why this is
 * worth fixing rather than living with: it is invisible until vector tiles or
 * a heavier workload make the main thread the bottleneck.
 *
 * Runs from postinstall and prebuild, so the copy cannot drift from the
 * installed version.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";

/**
 * BOTH files are required, and that is the whole point of this list.
 *
 * maplibre-gl-worker.mjs is not self-contained: it does
 * `import ... from "./maplibre-gl-shared.mjs"`. Copying only the worker gives
 * a file that serves with a 200 and the right MIME type and then dies on
 * startup because its sibling import 404s. MapLibre reports nothing — the
 * GeoJSON source simply never finishes loading (isSourceLoaded stays false,
 * no error event), so a heatmap renders empty over perfectly good data.
 *
 * The raster basemap keeps working throughout, because raster tiles are
 * fetched on the main thread. That is what makes this failure so quiet: the
 * map looks fine and only the data is missing.
 */
const FILES = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs", // imported by the worker — do not drop this
];

mkdirSync("public", { recursive: true });

for (const file of FILES) {
  const src = `node_modules/maplibre-gl/dist/${file}`;
  if (!existsSync(src)) {
    console.warn(`[sync-map-worker] ${src} not found — skipping (is maplibre-gl installed?)`);
    continue;
  }
  copyFileSync(src, `public/${file}`);
  console.log(`[sync-map-worker] ${src} -> public/${file}`);
}
