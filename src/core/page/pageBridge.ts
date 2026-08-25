import type { SweptField } from "../form/sweepFields";
import type { SubmitSpec } from "../types";

export interface FormReadout {
  fields: SweptField[];
  submit: SubmitSpec | null;
}

export interface PageBridge {
  /** Deterministic two-stage read: swept human-readable fields + submit control. */
  readForm(): Promise<FormReadout>;
  fill(elementId: string, value: string): Promise<void>;
  /** Check/uncheck a radio or checkbox input by its elementId. */
  setChecked(elementId: string, checked: boolean): Promise<void>;
  highlight(elementId: string, color: string): Promise<void>;
  clickSubmit(elementId: string): Promise<void>;
  currentDomain(): string;
}
