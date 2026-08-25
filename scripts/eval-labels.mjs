// Eval harness for the question -> canonical label LLM step.
// Builds EVAL_PAIRINGS random (question-subset, label-subset) pairings, runs each
// EVAL_REPEATS times, and reports accuracy + flakiness (do repeats of a pairing agree?).
// Usage: EVAL_ENDPOINT=http://localhost:8080/v1 EVAL_MODEL=<mini-model> [EVAL_KEY=...]
//        [EVAL_PAIRINGS=100] [EVAL_REPEATS=3] [EVAL_QUESTIONS=6] [EVAL_LABELS=12]
//        [EVAL_REGISTRY_PAD=0] npm run eval:labels
import { build } from "esbuild";
import { writeFile, rm, readFile } from "node:fs/promises";

const endpoint = process.env.EVAL_ENDPOINT;
const model = process.env.EVAL_MODEL;
const apiKey = process.env.EVAL_KEY || undefined;
const pairings = Number(process.env.EVAL_PAIRINGS || "100");
const repeats = Number(process.env.EVAL_REPEATS || "3");
const questionCount = Number(process.env.EVAL_QUESTIONS || "6");
const labelCount = Number(process.env.EVAL_LABELS || "12");
const temperature = Number(process.env.EVAL_TEMPERATURE || "0");
// Pad the registry with this many irrelevant decoy labels before the warm run, so
// the injection cap+ranking actually engages — measures whether a relevant learned
// label survives ranking when the registry is large (production behavior), not just
// the recency-only fallback that a tiny registry gives.
const registryPad = Number(process.env.EVAL_REGISTRY_PAD || "0");

if (!endpoint || !model) {
  console.error("Set EVAL_ENDPOINT and EVAL_MODEL (optional: EVAL_KEY, EVAL_PAIRINGS, EVAL_REPEATS, EVAL_QUESTIONS, EVAL_LABELS).");
  process.exit(1);
}

const bundle = await build({ entryPoints: ["src/eval/exports.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const tmp = new URL("./_eval-exports.mjs", import.meta.url);
await writeFile(tmp, bundle.outputFiles[0].text);
const { labelQuestions, buildLabelPrompt, CANONICAL_LABELS, buildIteration, aggregate, OpenAICompatibleAdapter, buildLabelVocab, Vault, scoreConvergence, scoreUnknown, LabelRegistry } = await import(tmp.href);
await rm(tmp);

const golden = JSON.parse(await readFile(new URL("../tests/fixtures/labels/golden.json", import.meta.url), "utf8"));
const client = new OpenAICompatibleAdapter({ baseUrl: endpoint, model, apiKey, temperature });
// Cold floor: authored descriptions with empty aliases (empty vault). Seed a Vault
// here to measure the lift from vault-accumulated aliases.
const allLabels = buildLabelVocab(CANONICAL_LABELS, new Vault());

console.log(`Eval: ${pairings} pairings x ${repeats} runs = ${pairings * repeats} calls; ${questionCount} questions & ${labelCount} labels each; model ${model}; temp ${temperature}\n`);

const perQuestion = new Map(); // question -> { correct, seen }
let stableInstances = 0;
let totalInstances = 0;
const t0 = Date.now();

for (let p = 0; p < pairings; p++) {
  const it = buildIteration(golden, allLabels, { questionCount, labelCount }, Math.random);
  const runLabels = new Map(it.questions.map((q) => [q, []]));

  for (let r = 0; r < repeats; r++) {
    let actual;
    try {
      actual = await labelQuestions(it.questions, it.vocab, client);
    } catch {
      actual = {}; // unparseable/garbled reply -> all UNKNOWN, keep going
    }
    if (process.env.EVAL_DEBUG && p === 0 && r === 0) {
      const prompt = buildLabelPrompt(it.questions, it.vocab);
      const dbg = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, temperature, stream: false, messages: [{ role: "system", content: prompt.system }, ...prompt.messages] }),
      });
      const content = (await dbg.json()).choices?.[0]?.message?.content;
      console.log("DEBUG vocab:", it.vocab.map((l) => l.name).join(", "));
      console.log("DEBUG raw model reply:\n" + content + "\n");
      for (const q of it.questions) console.log(`  "${q}"  expected=${it.expected[q]}  got=${actual[q] ?? "UNKNOWN"}`);
    }
    for (const q of it.questions) {
      const got = actual[q] ?? "UNKNOWN";
      runLabels.get(q).push(got);
      const st = perQuestion.get(q) || { correct: 0, seen: 0 };
      st.seen++;
      if (got === it.expected[q]) st.correct++;
      perQuestion.set(q, st);
    }
  }

  for (const [, labels] of runLabels) {
    totalInstances++;
    if (labels.every((l) => l === labels[0])) stableInstances++;
  }
  if ((p + 1) % 10 === 0) process.stdout.write(`  ${p + 1}/${pairings} pairings (${((Date.now() - t0) / 1000).toFixed(0)}s)\r`);
}
console.log("");

let totalCorrect = 0;
let totalSeen = 0;
for (const { correct, seen } of perQuestion.values()) {
  totalCorrect += correct;
  totalSeen += seen;
}

console.log(`\nOverall accuracy: ${((totalCorrect / totalSeen) * 100).toFixed(1)}% (${totalCorrect}/${totalSeen} labelings)`);
console.log(`Flakiness: ${stableInstances}/${totalInstances} pairing-questions gave the SAME label across all ${repeats} runs (${((stableInstances / totalInstances) * 100).toFixed(1)}% stable)`);
console.log(`\nPer-question accuracy (worst first):`);
for (const s of aggregate(perQuestion)) {
  console.log(`  ${((s.accuracy) * 100).toFixed(0).padStart(3)}%  (${s.correct}/${s.seen})  ${s.question}`);
}

// --- Open-set eval: convergence + UNKNOWN precision (the part golden.json can't see) ---
const openset = JSON.parse(await readFile(new URL("../tests/fixtures/labels/openset.json", import.meta.url), "utf8"));
// Label ONE question per call — cross-site convergence means phrasings never
// co-occur in a prompt, so batching siblings together would be trivially consistent.
const labelOne = async (q, vocab) => {
  try { return (await labelQuestions([q], vocab, client))[q] ?? "UNKNOWN"; } catch { return "UNKNOWN"; }
};

// COLD: each phrasing labeled independently with the seed vocab — the model's
// intrinsic consistency, i.e. how much drift the registry has to fix.
const coldActual = {};
for (const g of openset.convergence) for (const p of g.phrasings) coldActual[p] = await labelOne(p, allLabels);
const cold = scoreConvergence(openset.convergence, coldActual);

// WARM: prime the registry from each concept's FIRST phrasing (reusing its cold
// label), then re-label only the HELD-OUT phrasings with the registry-augmented
// (larger) vocab. The primed phrasing keeps its cold label as the reference and is
// NOT re-labeled — so warm-vs-cold isolates the registry's lift on the held-out
// phrasings, with no train/test leakage.
const registry = new LabelRegistry();
for (const g of openset.convergence) {
  const l0 = coldActual[g.phrasings[0]];
  if (l0 !== "UNKNOWN") registry.learn(l0, g.phrasings[0]);
}
// Decoys learned AFTER the real concepts, so the primed labels are the OLDEST — with
// the cap engaged they survive only if relevance (not recency) ranks them in.
for (let i = 0; i < registryPad; i++) registry.learn(`DECOY_LABEL_${i}`, `unrelated decoy field number ${i}`);
// Build the vocab PER held-out phrasing (passing it as the question) so the eval uses
// the production relevance+recency ranking, not a fixed all-in vocab.
const warmVocabFor = (p) => buildLabelVocab(CANONICAL_LABELS, new Vault(), registry, { questions: [p] });
const warmActual = {};
for (const g of openset.convergence) {
  warmActual[g.phrasings[0]] = coldActual[g.phrasings[0]]; // reference, not re-labeled
  for (const p of g.phrasings.slice(1)) warmActual[p] = await labelOne(p, warmVocabFor(p));
}
const warm = scoreConvergence(openset.convergence, warmActual);

// UNKNOWN precision with the primed (larger) vocab — the worst case for force-fit.
// Reuse the warm phrasing labels; label the non-fillables and seed extras fresh.
const fillable = [...openset.convergence.flatMap((g) => g.phrasings), ...(openset.fillableExtras ?? [])];
const unkActual = { ...warmActual };
for (const q of [...(openset.fillableExtras ?? []), ...openset.nonFillable]) unkActual[q] = await labelOne(q, warmVocabFor(q));
const unk = scoreUnknown(openset.nonFillable, fillable, unkActual);

console.log(`\nOpen-set convergence — each phrasing labeled independently (single-shot, temp ${temperature}):`);
console.log(`  cold (seed vocab):       ${(cold.rate * 100).toFixed(0)}% (${cold.converged}/${cold.groups})`);
console.log(`  warm (registry-primed):  ${(warm.rate * 100).toFixed(0)}% (${warm.converged}/${warm.groups})   (lift = registry reuse on held-out phrasings${registryPad ? `; +${registryPad} decoys, cap engaged` : ""})`);
for (const d of warm.detail) if (!d.converged) console.log(`    ✗ ${d.concept}: ${d.labels.join(" / ")}`);
console.log(`\nUNKNOWN precision (primed vocab):`);
console.log(`  non-fillable → UNKNOWN:  ${(unk.unknownRecall * 100).toFixed(0)}% (${unk.caughtUnknown}/${unk.nonFillable})`);
console.log(`  fillable → labeled:      ${(unk.fillableCoverage * 100).toFixed(0)}% (${unk.labeled}/${unk.fillable})`);
if (unk.wronglyLabeled.length) console.log(`  force-fit (non-fillable given a label): ${unk.wronglyLabeled.join("; ")}`);
if (unk.wronglyUnknown.length) console.log(`  punted (fillable → UNKNOWN): ${unk.wronglyUnknown.join("; ")}`);
