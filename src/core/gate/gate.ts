import { FilledEntry, Policy, GateVerdict } from "../types";
import { sensitivityFor } from "../labels/canonicalLabels";

/**
 * The single source of truth for "does staging this entry need explicit user
 * confirmation?" — consulted by the panel to decide whether a row is gated behind
 * the opt-in lock. Effective sensitivity is a matched detail's stored sensitivity,
 * else derived from the label — so a model-INVENTED sensitive label (SSN/CVV/CARD…)
 * with no stored detail, and option controls (always detail-less), still trip it.
 */
export function evaluate(entry: FilledEntry, policy: Policy): GateVerdict {
  const s = entry.detail?.sensitivity ?? sensitivityFor(entry.field.label);
  return policy.gateSensitivities.includes(s) ? "needsConfirmation" : "allow";
}
