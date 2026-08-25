export interface LabelScore {
  accuracy: number;
  correct: number;
  total: number;
  wrong: { question: string; expected: string; got: string }[];
}

/** Score a model's {question -> label} map against the golden expected map. */
export function scoreLabeling(
  expected: Record<string, string>,
  actual: Record<string, string>,
): LabelScore {
  const questions = Object.keys(expected);
  const wrong: LabelScore["wrong"] = [];
  let correct = 0;
  for (const q of questions) {
    const got = actual[q] ?? "UNKNOWN";
    if (got === expected[q]) correct++;
    else wrong.push({ question: q, expected: expected[q]!, got });
  }
  const total = questions.length;
  return { accuracy: total === 0 ? 1 : correct / total, correct, total, wrong };
}
