/** Hostname of a URL, or "" when the URL is absent or unparsable. */
export function hostnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Decide which persisted tab reviews to rehydrate. A tab still open in this
 * window on the same domain restores; one whose domain changed (it navigated
 * while the panel was closed, so its stored elementIds are dead) drops; a tab
 * absent from `liveDomains` (closed, or another window's) is left alone — the
 * cross-window prune handles it.
 */
export function partitionRestorable(
  restored: Map<number, { domain: string }>,
  liveDomains: Map<number, string>,
): { restore: number[]; drop: number[] } {
  const restore: number[] = [];
  const drop: number[] = [];
  for (const [tabId, review] of restored) {
    if (!liveDomains.has(tabId)) continue;
    if (liveDomains.get(tabId) === review.domain) restore.push(tabId);
    else drop.push(tabId);
  }
  return { restore, drop };
}
