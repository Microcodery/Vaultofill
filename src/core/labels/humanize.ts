/** A canonical label's words, lowercase: CUMULATIVE_GPA → "cumulative gpa".
 *  Used where the text flows into a sentence (e.g. an LLM prompt description). */
export function humanizeWords(name: string): string {
  return name.toLowerCase().replace(/_/g, " ");
}

/** A canonical label for display, first letter capitalized:
 *  CUMULATIVE_GPA → "Cumulative gpa". */
export function humanizeLabel(name: string): string {
  return humanizeWords(name).replace(/^./, (c) => c.toUpperCase());
}
