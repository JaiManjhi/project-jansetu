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

function encodePng(size, pixelAt) {
  // Raw scanlines: one filter byte (0 = none) then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y, size);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
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
 * A bridge over water, echoing the JanSetu logo: navy ground, white deck and
 * piers, green river beneath.
 *
 * Simplified on purpose. The full logo carries a bridge, four figures, a
 * government building, a factory, gears and an arc — that is right for a
 * header or a slide, and unreadable at 32px in a browser tab. The bridge is
 * the load-bearing idea (Setu means bridge), so it is what survives the crop.
 */
function bridgeMark(x, y, size) {
  const u = size / 32; // design grid unit
  const gx = x / u;
  const gy = y / u;

  // River: green band across the lower third, as in the logo. Checked first so
  // it sits behind nothing — the piers stop above it.
  if (gy >= 24.5) return GREEN;

  // Deck: horizontal bar across the middle.
  if (gy >= 14 && gy < 16.5 && gx >= 5 && gx < 27) return WHITE;

  // Piers: two uprights below the deck.
  if (gy >= 16.5 && gy < 24 && ((gx >= 9 && gx < 11.5) || (gx >= 20.5 && gx < 23))) {
    return WHITE;
  }

  // Arch: a band of a circle centred on the deck, opening downward.
  const cx = 16;
  const cy = 16.5;
  const dx = gx - cx;
  const dy = gy - cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (dy > 0 && r >= 5.5 && r < 7.5 && gy < 24) return WHITE;

  return NAVY;
}

mkdirSync("public", { recursive: true });
for (const size of [192, 512, 180]) {
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  writeFileSync(`public/${name}`, encodePng(size, bridgeMark));
  console.log(`[gen:icons] public/${name} (${size}x${size})`);
}
