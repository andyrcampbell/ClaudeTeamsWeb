// Builds the interviewee headshot pool that ships inside the installer.
//
// The full library (~180 MB of 450x600 PNGs) is far too big to bundle, and
// most of it is never used: a team needs a handful of unique faces. This
// takes the first N of each gender, down-samples to 360x480 and palette-
// encodes them (~36 KB each), for ~7 MB total.
//
// Kept as PNG with the original person_NN.png filenames on purpose — the
// team-setup prompts reference specific files, e.g. "Unassigned
// interviewees/Male/person_06.png" for Charles.
//
//   node scripts/make-interviewee-pool.js [sourceDir] [perGender]

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SRC = process.argv[2] || "M:/MyStuff/MyAITeams/Unassigned interviewees";
const PER_GENDER = Number(process.argv[3] || 100);
const OUT = path.join(__dirname, "..", "resources", "Unassigned interviewees");

const num = (f) => Number((f.match(/(\d+)/) || [0, 0])[1]);

async function buildGender(gender) {
  const srcDir = path.join(SRC, gender);
  const outDir = path.join(OUT, gender);
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort((a, b) => num(a) - num(b))
    .slice(0, PER_GENDER);

  let bytes = 0;
  for (const file of files) {
    const buf = await sharp(path.join(srcDir, file))
      .resize(360, 480)
      .png({ palette: true, colors: 128, quality: 80, effort: 8 })
      .toBuffer();
    fs.writeFileSync(path.join(outDir, file), buf);
    bytes += buf.length;
  }
  console.log(`${gender}: ${files.length} images, ${(bytes / 1048576).toFixed(1)} MB`);
  return files;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const male = await buildGender("Male");
  await buildGender("Female");
  // The prompts name this one explicitly; fail loudly if the pool loses it.
  if (!male.includes("person_06.png")) {
    throw new Error("person_06.png missing from the Male pool - prompts reference it by name.");
  }
})();
