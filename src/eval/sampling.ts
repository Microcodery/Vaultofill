import { CanonicalLabel } from "../core/labels/canonicalLabels";

/** Returns a float in [0, 1). Inject a seeded one in tests; Math.random in the runner. */
export type Rng = () => number;

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

export function pickN<T>(arr: readonly T[], n: number, rng: Rng): T[] {
  return shuffle(arr, rng).slice(0, Math.max(0, Math.min(n, arr.length)));
}

export interface Iteration {
  questions: string[];
  vocab: CanonicalLabel[];
  expected: Record<string, string>;
}

/**
 * One random eval iteration: a random subset of questions plus a label set that
 * ALWAYS contains the labels those questions need (so a correct answer is
 * possible) padded with random distractor labels up to `labelCount`.
 */
export function buildIteration(
  golden: Record<string, string>,
  allLabels: readonly CanonicalLabel[],
  opts: { questionCount: number; labelCount: number },
  rng: Rng,
): Iteration {
  const questions = pickN(Object.keys(golden), opts.questionCount, rng);
  const expected: Record<string, string> = {};
  for (const q of questions) expected[q] = golden[q]!;

  const needed = new Set(questions.map((q) => golden[q]!));
  const neededLabels = allLabels.filter((l) => needed.has(l.name));
  const distractors = allLabels.filter((l) => !needed.has(l.name));
  const extra = pickN(distractors, opts.labelCount - neededLabels.length, rng);
  const vocab = shuffle([...neededLabels, ...extra], rng);
  return { questions, vocab, expected };
}

export interface QuestionStat {
  question: string;
  correct: number;
  seen: number;
  accuracy: number;
}

/** Aggregate per-question correct/seen counts into stats, worst accuracy first. */
export function aggregate(perQuestion: Map<string, { correct: number; seen: number }>): QuestionStat[] {
  return [...perQuestion.entries()]
    .map(([question, { correct, seen }]) => ({ question, correct, seen, accuracy: seen === 0 ? 0 : correct / seen }))
    .sort((a, b) => a.accuracy - b.accuracy);
}
