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

const SRC = "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";
const DEST = "public/maplibre-gl-worker.mjs";

if (!existsSync(SRC)) {
  console.warn(`[sync-map-worker] ${SRC} not found — skipping (is maplibre-gl installed?)`);
  process.exit(0);
}
mkdirSync("public", { recursive: true });
copyFileSync(SRC, DEST);
console.log(`[sync-map-worker] ${SRC} -> ${DEST}`);
