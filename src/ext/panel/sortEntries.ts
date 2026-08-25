import { Confidence, FilledEntry } from "../../core/types";

const ATTENTION_ORDER: Record<Confidence, number> = {
  missing: 0,
  connected: 1,
  certain: 2,
};

/**
 * Orders entries by attention needed: missing (red) first, then connected
 * (yellow), then certain (green). Stable within each group.
 */
export function sortByConfidence(entries: FilledEntry[]): FilledEntry[] {
  return [...entries].sort((a, b) => ATTENTION_ORDER[a.confidence] - ATTENTION_ORDER[b.confidence]);
}
