// Builds the static interactive demo (demo/*) to dist/demo/ for GitHub Pages.
// Bundles the top-level app and the in-iframe bridge, copies the shell + the
// fixture forms, and writes a forms.json manifest with humanized titles.
//
// VERIFY: `node scripts/build-demo.mjs` then `npm run serve:demo` and open
// http://localhost:8080 — pick forms, click Fill, and confirm cross-form linking.
import { build } from "esbuild";
import { readdir, mkdir, rm, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const outDir = new URL("dist/demo/", root);
const formsSrcDir = new URL("tests/fixtures/forms/", root);
const formsOutDir = new URL("forms/", outDir);

await rm(outDir, { recursive: true, force: true });
await mkdir(formsOutDir, { recursive: true });

// Two bundles: the top-level app (demo.js) and the iframe-realm bridge
// (demoFrame.js) that demo.js injects into each loaded form.
await build({
  entryPoints: {
    demo: fileURLToPath(new URL("demo/demo.ts", root)),
    demoFrame: fileURLToPath(new URL("demo/demoFrame.ts", root)),
  },
  outdir: fileURLToPath(outDir),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
});

await copyFile(new URL("demo/index.html", root), new URL("index.html", outDir));
await copyFile(new URL("demo/demo.css", root), new URL("demo.css", outDir));

const ACRONYMS = { saas: "SaaS", w9: "W-9", gpa: "GPA", w2: "W-2" };
/** "small-business-grant" → "Small Business Grant" (with a few acronym fixups). */
const humanize = (file) =>
  file
    .replace(/\.html$/, "")
    .split("-")
    .map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// A curated opening so the first form shows the "one vault fills every form" story
// (lots of green) and adjacent forms set up the cross-form linking story (shared
// concepts phrased differently — trip dates, then company goals). The rest follow
// alphabetically.
const FEATURED = [
  "job-application.html",
  "apartment-rental-application.html",
  "hotel-reservation.html",
  "flight-booking.html",
  "car-rental.html",
  "small-business-grant.html",
  "innovation-grant.html",
  "startup-accelerator.html",
];
const all = (await readdir(formsSrcDir)).filter((f) => f.endsWith(".html") && f !== "index.html");
const featured = FEATURED.filter((f) => all.includes(f));
const files = [...featured, ...all.filter((f) => !featured.includes(f)).sort()];

for (const file of files) {
  await copyFile(new URL(file, formsSrcDir), new URL(file, formsOutDir));
}

const manifest = files.map((file) => ({ file, title: humanize(file) }));
await writeFile(new URL("forms.json", outDir), JSON.stringify(manifest, null, 2));

console.log(`Built demo → ${fileURLToPath(outDir)} (${files.length} forms)`);
