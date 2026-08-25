import { FormSchema, FilledEntry, Confidence } from "../types";
import { PageBridge } from "../page/pageBridge";

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  certain: "green",
  connected: "yellow",
  missing: "red",
};

/**
 * Reads a live DOM form deterministically: the page bridge sweeps the visible
 * fields (human-readable question + stable elementId) and finds the submit
 * control. Canonical labels are assigned later by the matcher's labeling stage,
 * so swept fields start with an empty `label`.
 */
export class DomFormSource {
  private schema?: FormSchema;
  // `schema` seeds a restored source (from a persisted review) so it can commit
  // without a fresh read — only the submit target is needed for commit().
  constructor(private cfg: { page: PageBridge; schema?: FormSchema }) {
    this.schema = cfg.schema;
  }

  async getSchema(): Promise<FormSchema> {
    const { fields, submit } = await this.cfg.page.readForm();
    if (!submit) throw new Error("no submit control found on the page");
    this.schema = {
      fields: fields.map((f) => ({ label: "", humanReadable: f.humanReadable, elementId: f.elementId, control: f.control })),
      submit,
    };
    return this.schema;
  }

  async stage(entries: FilledEntry[]): Promise<void> {
    for (const entry of entries) {
      const { control, elementId } = entry.field;
      if (entry.value == null) continue;

      if (control && (control.tag === "radio" || control.tag === "checkbox")) {
        // Radio → one selected value; checkbox → newline-joined selected values.
        const selected = new Set(
          control.tag === "checkbox" ? entry.value.split("\n").filter(Boolean) : entry.value ? [entry.value] : [],
        );
        for (const option of control.options ?? []) {
          if (!option.elementId) continue;
          const on = selected.has(option.value);
          // Checkbox: set each independently. Radio: only check the chosen one
          // (the browser unchecks its siblings), so we don't fire change on them.
          if (control.tag === "checkbox" || on) await this.cfg.page.setChecked(option.elementId, on);
          if (on) await this.cfg.page.highlight(option.elementId, CONFIDENCE_COLOR[entry.confidence]);
        }
        continue;
      }

      if (!elementId) continue;
      await this.cfg.page.fill(elementId, entry.value);
      await this.cfg.page.highlight(elementId, CONFIDENCE_COLOR[entry.confidence]);
    }
  }

  async commit(): Promise<void> {
    if (this.schema?.submit.kind !== "dom") throw new Error("dom source requires DOM submit");
    await this.cfg.page.clickSubmit(this.schema.submit.elementId);
  }
}
