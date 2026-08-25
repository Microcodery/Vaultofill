export type Sensitivity = "public" | "private" | "sensitive";
export type Volatility = "stable" | "volatile" | "ephemeral";

export interface Detail {
  canonicalLabel: string;
  /** A named alternative for this label, e.g. "personal" / "work" for EMAIL.
   *  Undefined or "" is the default/only value. A label can hold several. */
  variant?: string;
  value: string;
  humanReadable?: string;
  aliases: string[];
  sensitivity: Sensitivity;
  volatility: Volatility;
}

export type SubmitSpec = { kind: "dom"; elementId: string };

/** A choosable option; `elementId` is set for radio/checkbox options (the page
 *  input to check) and absent for <select> options (the select itself is filled). */
export interface FieldOption { value: string; label: string; elementId?: string; }
/** The page control a field is, so the review UI can mirror it (a dropdown with
 *  the same options, a date/number input, a textarea, a radio/checkbox group)
 *  instead of a plain text box. Radio/checkbox tags collapse a whole name-group
 *  into one field whose `options` are its members. */
export interface FieldControl {
  tag: "input" | "select" | "textarea" | "radio" | "checkbox";
  inputType?: string; // for tag "input": the page's input type (date, number, email, …)
  options?: FieldOption[]; // for tag "select" | "radio" | "checkbox"
}
export interface FormField { label: string; humanReadable: string; elementId?: string; control?: FieldControl; }
export interface FormSchema { fields: FormField[]; submit: SubmitSpec; }

export type Confidence = "certain" | "connected" | "missing";
/** `volatility` overrides the storage tier (from the review UI). `variants` are
 *  the label's saved named alternatives (for the review dropdown); `variant` is
 *  the one chosen/edited, under which the value is (re)saved. */
export interface FilledEntry {
  field: FormField;
  value: string | null;
  confidence: Confidence;
  detail?: Detail;
  volatility?: Volatility;
  variants?: Detail[];
  variant?: string;
  /** The label was DERIVED from the question (model returned UNKNOWN), not invented
   *  by the model. Such labels aren't worth remembering in the vocabulary — they're
   *  per-phrasing, not a semantic name — so the registry skips them. */
  derivedLabel?: boolean;
}

export interface Policy { gateSensitivities: Sensitivity[]; }
export const DEFAULT_POLICY: Policy = { gateSensitivities: ["sensitive"] };

export type GateVerdict = "allow" | "needsConfirmation";
