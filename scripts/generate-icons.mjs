/**
 * Generates the PWA icons into public/.
 *
 *   npm run gen:icons
 *
 * Sources `public/logo.png` — the JanSetu emblem — and derives every icon size
 * from it, so the mark is changed in one place and the icons follow.
 *
 * This replaced a hand-drawn geometric bridge encoded pixel by pixel with
 * node:zlib. That was the right call while there was no artwork to work from
 * and the wrong one the moment there was: it produced a 615-byte 192x192 that
 * did not read as the JanSetu mark at any size. If the emblem is ever replaced,
 * drop the new file at public/logo.png and re-run this.
 *
 * The margin is trimmed and re-added deliberately. The source has a generous
 * white border, and a home-screen icon that keeps it renders as a small circle
 * floating in a large white tile. Trimming to the artwork and padding back a
 * measured amount makes the mark fill its tile the way every other app on the
 * screen does.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";

const SOURCE = "public/logo.png";

/**
 * Padding around the trimmed mark, as a fraction of the icon.
 *
 * Android maskable icons can crop up to ~10% from each edge, so the emblem
 * needs breathing room or the circle loses its rim on some launchers. 8% is
 * enough to survive that without the mark looking lost.
 */
const PAD = 0.08;

const SIZES = [
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
  { size: 180, name: "apple-touch-icon.png" },
];

if (!existsSync(SOURCE)) {
  console.error(
    `[gen:icons] ${SOURCE} is missing. Put the JanSetu emblem there and re-run — ` +
      `the icons are derived from it and there is no fallback artwork.`,
  );
  process.exit(1);
}

/**
 * White, not transparent. These are app icons: a transparent PNG renders on
 * whatever the launcher chooses, and this mark carries white bridge cables and
 * white buildings that vanish on a light background.
 */
const BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };

const trimmed = await sharp(SOURCE).trim({ threshold: 10 }).toBuffer();

for (const { size, name } of SIZES) {
  const inner = Math.round(size * (1 - PAD * 2));
  await sharp(trimmed)
    .resize(inner, inner, { fit: "contain", background: BACKGROUND })
    .extend({
      top: Math.round((size - inner) / 2),
      bottom: Math.round((size - inner) / 2),
      left: Math.round((size - inner) / 2),
      right: Math.round((size - inner) / 2),
      background: BACKGROUND,
    })
    // Palette, not truecolour. The emblem uses a handful of flat colours, and
    // a palette PNG is a fraction of the size with no visible difference —
    // icon-512 went from 192 KB to a fraction of that.
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toFile(`public/${name}`);
  console.log(`[gen:icons] public/${name} (${size}x${size})`);
}
