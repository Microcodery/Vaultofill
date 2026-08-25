import { ReviewResult } from "../../core/fill/persistReview";
import { FilledEntry, FormField } from "../../core/types";
import { sortByConfidence } from "./sortEntries";
import { resolveReviewEntry, Unlearn } from "./resolveReviewEntry";
import { buildEntryRow, buildPendingRow, ReviewRow } from "./reviewRow";

/** Read-only view shown WHILE labeling runs: deterministic (green) matches are
 *  shown populated; not-yet-labeled fields show a disabled skeleton. The final
 *  renderReview replaces this once labeling finishes. Rows are ordered pending-
 *  first, greens-last — matching renderReview's missing→connected→certain sort —
 *  so the resolved rows don't jump position when the final view renders. */
export function renderProgressive(container: HTMLElement, fields: FormField[], partial: (FilledEntry | undefined)[]): void {
  container.innerHTML = "";

  const matched = partial.filter((e): e is FilledEntry => e !== undefined);
  const pendingCount = fields.length - matched.length;
  const note = document.createElement("div");
  note.className = "vof-progress-note";
  note.textContent =
    pendingCount === 0
      ? "Finishing…"
      : matched.length
        ? `Matched ${matched.length} field${matched.length === 1 ? "" : "s"} — labeling ${pendingCount} more…`
        : "Labeling fields…";
  container.appendChild(note);

  fields.forEach((field, i) => {
    if (!partial[i]) container.appendChild(buildPendingRow(field));
  });
  for (const entry of sortByConfidence(matched)) container.appendChild(buildEntryRow(entry, { preview: true }).rowEl);
}

/**
 * Render the interactive review. Each Fill / Fill & Submit click reads the
 * current row inputs and calls `onAction(review, submit)` — the panel then
 * persists + stages (+ commits) and re-renders (so the review is a persistent,
 * re-usable workspace: edit a value, Fill again, see it go green). Buttons
 * disable during the apply; the re-render restores fresh, enabled ones.
 */
export function renderReview(
  container: HTMLElement,
  entries: FilledEntry[],
  onAction: (review: ReviewResult, unlearn: Unlearn[], submit: boolean) => void,
): void {
  container.innerHTML = "";

  const rows: ReviewRow[] = [];
  for (const entry of sortByConfidence(entries)) {
    const { rowEl, row } = buildEntryRow(entry);
    container.appendChild(rowEl);
    rows.push(row);
  }

  const actions = document.createElement("div");
  actions.className = "vof-actions";
  const fillOnlyButton = document.createElement("button");
  fillOnlyButton.id = "fill-only-button";
  fillOnlyButton.textContent = "Fill";
  const submitButton = document.createElement("button");
  submitButton.id = "submit-button";
  submitButton.textContent = "Fill & Submit";
  actions.append(fillOnlyButton, submitButton);
  container.appendChild(actions);

  const finish = (submit: boolean): void => {
    fillOnlyButton.disabled = true;
    submitButton.disabled = true;
    const unlearn: Unlearn[] = [];
    const resultEntries: FilledEntry[] = rows.map(({ entry, getValue, getVolatility, getVariant, getNewLabel, includeCheckbox }) => {
      const { entry: resolved, unlearn: u } = resolveReviewEntry(entry, {
        newLabelRaw: getNewLabel?.(),
        currentValue: getValue?.() ?? entry.value ?? "",
        included: includeCheckbox?.checked ?? true,
        chosenVariant: getVariant?.(),
        volatility: getVolatility?.(),
      });
      if (u) unlearn.push(u);
      return resolved;
    });

    const confirmedYellow: FormField[] = rows
      .filter(({ entry, includeCheckbox }) => entry.confidence === "connected" && (includeCheckbox?.checked ?? true))
      .map(({ entry }) => entry.field);

    onAction({ entries: resultEntries, confirmedYellow }, unlearn, submit);
  };

  fillOnlyButton.addEventListener("click", () => finish(false));
  submitButton.addEventListener("click", () => finish(true));
}
