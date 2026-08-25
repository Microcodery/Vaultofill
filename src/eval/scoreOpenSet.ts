// Scoring for the OPEN-SET half of the labeling step — the part the closed-set
// golden eval can't see: does the model give the same novel concept a stable
// label across phrasings (convergence), and does it correctly reserve UNKNOWN for
// non-fillable fields without force-fitting them onto invented labels (the
// regression an inflated invented-label vocabulary would cause)?

/** A novel concept phrased several ways — they should all map to ONE label. */
export interface ConvergenceGroup {
  concept: string;
  phrasings: string[];
}

export interface ConvergenceScore {
  groups: number;
  converged: number; // groups whose phrasings all agree on one real (non-UNKNOWN) label
  rate: number;
  detail: { concept: string; labels: string[]; converged: boolean }[];
}

/** How consistently the model labels differently-phrased instances of the same
 *  concept. A group "converges" when every phrasing gets the SAME non-UNKNOWN
 *  label — the property the LabelRegistry exists to enforce across sites. */
export function scoreConvergence(groups: ConvergenceGroup[], actual: Record<string, string>): ConvergenceScore {
  const detail = groups.map((g) => {
    const labels = [...new Set(g.phrasings.map((p) => actual[p] ?? "UNKNOWN"))];
    const converged = labels.length === 1 && labels[0] !== "UNKNOWN";
    return { concept: g.concept, labels, converged };
  });
  const converged = detail.filter((d) => d.converged).length;
  return { groups: groups.length, converged, rate: groups.length === 0 ? 1 : converged / groups.length, detail };
}

export interface UnknownScore {
  nonFillable: number;
  caughtUnknown: number; // non-fillable correctly labeled UNKNOWN
  unknownRecall: number;
  fillable: number;
  labeled: number; // fillable given a real label (not wrongly UNKNOWN)
  fillableCoverage: number;
  wronglyLabeled: string[]; // non-fillable that got a real label — the force-fit / bloat risk
  wronglyUnknown: string[]; // fillable the model punted on
}

/** UNKNOWN precision, both directions: non-fillable fields (captcha, search, terms)
 *  should be UNKNOWN; fillable fields should NOT be. `wronglyLabeled` is the
 *  failure an inflated invented-label vocab causes — force-fitting a non-fillable
 *  field onto a spurious label. */
export function scoreUnknown(nonFillable: string[], fillable: string[], actual: Record<string, string>): UnknownScore {
  const isUnknown = (q: string): boolean => (actual[q] ?? "UNKNOWN") === "UNKNOWN";
  const wronglyLabeled = nonFillable.filter((q) => !isUnknown(q));
  const wronglyUnknown = fillable.filter((q) => isUnknown(q));
  const caughtUnknown = nonFillable.length - wronglyLabeled.length;
  const labeled = fillable.length - wronglyUnknown.length;
  return {
    nonFillable: nonFillable.length,
    caughtUnknown,
    unknownRecall: nonFillable.length === 0 ? 1 : caughtUnknown / nonFillable.length,
    fillable: fillable.length,
    labeled,
    fillableCoverage: fillable.length === 0 ? 1 : labeled / fillable.length,
    wronglyLabeled,
    wronglyUnknown,
  };
}
