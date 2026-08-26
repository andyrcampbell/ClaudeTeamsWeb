// One-off helper: derive a square icon-source.png from the wide (1778x1000)
// brand logomark, by trimming to its visible content and padding to a square
// canvas. Not part of the app runtime — run manually before `dist:win`/`dist:mac`
// if the icon source needs regenerating.
const path = require("path");
const sharp = require("sharp");

const SRC = path.join(__dirname, "..", "public", "assets", "logo.png");
const OUT = path.join(__dirname, "..", "build", "icon-source.png");
const SIZE = 1024;
const PADDING = 0.14; // fraction of canvas kept empty around the trimmed mark

async function main() {
  const trimmed = await sharp(SRC).trim({ threshold: 10 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  const inner = Math.round(SIZE * (1 - PADDING * 2));
  const scale = Math.min(inner / meta.width, inner / meta.height);
  const resizedW = Math.round(meta.width * scale);
  const resizedH = Math.round(meta.height * scale);

  await sharp(trimmed)
    .resize(resizedW, resizedH)
    .extend({
      top: Math.floor((SIZE - resizedH) / 2),
      bottom: Math.ceil((SIZE - resizedH) / 2),
      left: Math.floor((SIZE - resizedW) / 2),
      right: Math.ceil((SIZE - resizedW) / 2),
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toFile(OUT);

  console.log(`Wrote ${OUT} (${SIZE}x${SIZE})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
