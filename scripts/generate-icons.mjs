/**
 * Generates the PWA icons into public/.
 *
 *   npm run gen:icons
 *
 * Written as a generator rather than committed binaries so the mark can be
 * changed in one place, and so nobody has to open a design tool to adjust it.
 * Uses only node:zlib — a PNG is just a zlib-deflated scanline stream plus
 * three chunks, which is less code than pulling in an image library.
 *
 * The mark is a bridge: JanSetu means "people's bridge", and DESIGN.md §6
 * bans emoji and stock imagery, so a plain geometric form is the honest
 * choice. Accent ground, white deck and two piers.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// Sampled from the JanSetu logo: navy from the "Jan" wordmark and the bridge,
// green from "Setu" and the riverbank. The app icon uses a navy ground so it
// stays legible on both light and dark home screens — the logo itself sits on
// white, which would vanish against a light background at 32px.
const NAVY = [0x1f, 0x3f, 0x77];
const GREEN = [0x3d, 0x9b, 0x35];
const ORANGE = [0xf1, 0x8a, 0x21];
const RIVER = [0x2f, 0x5c, 0xa8];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * 3x3 supersampling. The mark is nearly all curves — a circle, an arch, cable
 * sweeps — and sampling one point per pixel gave every one of them a hard
 * staircase edge that was plainly visible at 32px in a browser tab. Averaging
 * nine samples costs nothing at these sizes and is the difference between the
 * icon reading as drawn or as broken.
 */
const SS = 3;

function encodePng(size, pixelAt) {
  // Raw scanlines: one filter byte (0 = none) then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb] = pixelAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size);
          r += pr;
          g += pg;
          b += pb;
        }
      }
      const n = SS * SS;
      raw[o++] = Math.round(r / n);
      raw[o++] = Math.round(g / n);
      raw[o++] = Math.round(b / n);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The JanSetu mark, reduced to what survives at 32px.
 *
 * The full logo carries a bridge, four raised figures, a government building, a
 * factory, gears and a connecting arc. All of that is right on a slide and
 * illegible in a browser tab, so this keeps the three things that actually
 * identify it: the circular badge, the tri-colour sweep (orange, navy, green)
 * that stands for citizens, government and industry, and the suspension bridge
 * — Setu means bridge, and it is the load-bearing idea.
 *
 * ⚠ This is a reduction of the logo, not the logo. Drop the real artwork in as
 * public/logo.png and this script becomes unnecessary for the icons.
 */
function bridgeMark(x, y, size) {
  const u = size / 32; // design grid unit
  const gx = x / u;
  const gy = y / u;

  const cx = 16;
  const cy = 16;
  const dx = gx - cx;
  const dy = gy - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Outside the badge: white, so the mark reads as a roundel rather than a
  // square tile with a drawing in it.
  if (dist > 15.4) return WHITE;

  // --- the bridge, drawn over whatever ground is beneath it ---

  // Deck: a horizontal band across the badge.
  if (gy >= 15.2 && gy < 17.2 && Math.abs(dx) < 13) return WHITE;

  // Towers: two uprights rising above the deck.
  const tower = (tx) => Math.abs(gx - tx) < 1.1 && gy >= 7.5 && gy < 15.2;
  if (tower(9.5) || tower(22.5)) return WHITE;

  // Main cables: two sweeps sagging between the towers and out to the edges.
  // Modelled as parabolas, which is what a suspension cable actually is.
  const cable = (x0, x1, yTop, yLow) => {
    if (gx < x0 || gx > x1) return false;
    const t = (gx - x0) / (x1 - x0);
    const yc = yTop + (yLow - yTop) * 4 * t * (1 - t);
    return Math.abs(gy - yc) < 0.85;
  };
  if (cable(9.5, 22.5, 8.0, 14.2)) return WHITE;
  // Side spans: anchored low at the rim, rising to meet each tower top. Drawn
  // as half-parabolas so they read as continuing cable rather than arches.
  const sideCable = (x0, x1, yAnchor, yTower, risingRight) => {
    if (gx < x0 || gx > x1) return false;
    const t = (gx - x0) / (x1 - x0);
    const k = risingRight ? t * t : (1 - t) * (1 - t);
    const yc = yAnchor + (yTower - yAnchor) * (risingRight ? 1 - k : 1 - k);
    return Math.abs(gy - yc) < 0.8;
  };
  if (sideCable(4.5, 9.5, 13.4, 8.0, false)) return WHITE;
  if (sideCable(22.5, 27.5, 8.0, 13.4, true)) return WHITE;

  // Piers below the deck, stopping at the water.
  if (gy >= 17.2 && gy < 22 && (Math.abs(gx - 11) < 1.1 || Math.abs(gx - 21) < 1.1)) {
    return WHITE;
  }

  // --- ground beneath the bridge ---

  // River across the lower part of the badge. The divide is a curve, not a
  // vertical cut — a straight split read as two quadrants stuck together
  // rather than water meeting a bank.
  if (gy >= 21.5) {
    const bank = 16 + 3.2 * Math.sin((gy - 21.5) * 0.55);
    return gx < bank ? RIVER : GREEN;
  }

  // Upper badge: orange on the left, green on the right, navy through the
  // middle — the logo's three constituencies meeting over the bridge.
  if (gy < 15.2) {
    // Narrow wedges near the rim only. Wide ones made the badge look like a
    // pie chart; in the logo the orange and green are arcs around the edge with
    // navy holding the centre.
    const angle = Math.atan2(cy - gy, gx - cx); // 0 = right, PI/2 = up
    if (angle > 2.30 && dist > 6.5) return ORANGE;
    if (angle < 0.84 && dist > 6.5) return GREEN;
  }

  return NAVY;
}

mkdirSync("public", { recursive: true });
for (const size of [192, 512, 180]) {
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  writeFileSync(`public/${name}`, encodePng(size, bridgeMark));
  console.log(`[gen:icons] public/${name} (${size}x${size})`);
}
