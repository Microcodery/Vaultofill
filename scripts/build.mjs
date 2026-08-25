// Bundles the extension shell (src/ext/*) to dist/chrome/ and dist/firefox/
// for loading unpacked in each browser. Kept intentionally simple — a real
// release build will also need icons.
//
// VERIFY-AGAINST-INSTALLED: run `node scripts/build.mjs` and load the
// resulting dist/chrome/ and dist/firefox/ as unpacked extensions in their
// respective browsers before relying on this output.
import { build } from "esbuild";
import { writeFile, mkdir, rm, copyFile, cp } from "node:fs/promises";

const distRoot = new URL("../dist/", import.meta.url);
const sharedDir = new URL("_shared/", distRoot);
const targets = {
  chrome: new URL("chrome/", distRoot),
  firefox: new URL("firefox/", distRoot),
};

await rm(sharedDir, { recursive: true, force: true });
await mkdir(sharedDir, { recursive: true });

await build({
  entryPoints: {
    background: "src/ext/background.ts",
    "content/contentScript": "src/ext/content/contentScript.ts",
    panel: "src/ext/panel/panel.ts",
    // Offscreen document (Chrome): hosts the on-device model so it can load/stay
    // resident in the background, independent of the side panel.
    offscreen: "src/ext/offscreen/offscreen.ts",
    // Static bundled web-llm worker (loaded from a packaged URL, not a blob:) —
    // this is what lets on-device inference clear the MV3 CSP.
    "webllm-worker": "src/ext/panel/webllm-worker.ts",
  },
  bundle: true,
  outdir: sharedDir.pathname,
  format: "esm",
  target: "es2022",
  platform: "browser",
});

await copyFile(
  new URL("../src/ext/panel/sidepanel.html", import.meta.url),
  new URL("sidepanel.html", sharedDir),
);

await copyFile(
  new URL("../src/ext/offscreen/offscreen.html", import.meta.url),
  new URL("offscreen.html", sharedDir),
);

// manifest.ts is plain TS (no browser APIs), so it's cheapest to bundle it
// to a throwaway ESM file and import that, rather than re-implement its
// shape in JS here.
const manifestBundle = await build({
  entryPoints: ["src/ext/manifest.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const manifestTmpPath = new URL("_manifest.mjs", sharedDir);
await writeFile(manifestTmpPath, manifestBundle.outputFiles[0].text);
const { chromeManifest, firefoxManifest } = await import(manifestTmpPath.href);
await rm(manifestTmpPath);

const manifestsByTarget = { chrome: chromeManifest, firefox: firefoxManifest };

for (const [name, dir] of Object.entries(targets)) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(sharedDir, dir, { recursive: true });
  // The offscreen document is Chrome-only (Firefox has no chrome.offscreen);
  // drop its bundle from the Firefox target rather than ship dead weight.
  if (name === "firefox") {
    await rm(new URL("offscreen.html", dir), { force: true });
    await rm(new URL("offscreen.js", dir), { force: true });
  }
  await writeFile(
    new URL("manifest.json", dir),
    JSON.stringify(manifestsByTarget[name], null, 2),
  );
  console.log(`Built ${name} extension to ${dir.pathname}`);
}

await rm(sharedDir, { recursive: true, force: true });
