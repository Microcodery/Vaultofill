export const VOF_INDEX_PATTERN = /^vof-(\d+)$/;

/** The next free `vof-<n>` index: one past the highest existing suffix in `doc`. */
export function nextVofIndex(doc: Document): number {
  let next = 0;
  for (const el of doc.querySelectorAll("[data-vof]")) {
    const match = el.getAttribute("data-vof")?.match(VOF_INDEX_PATTERN);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return next;
}

/**
 * An id assigner seeded past every `vof-<n>` already in `doc` at creation time.
 * Returns an element's existing `data-vof` untouched; otherwise assigns the
 * next sequential id. Seeding from the document (rather than a shared counter)
 * is what lets `findSubmit` run after `sweepFields` yet never collide with the
 * ids the sweep just assigned.
 */
export function createVofIdAssigner(doc: Document): (el: Element) => string {
  let next = nextVofIndex(doc);
  return (el) => {
    let id = el.getAttribute("data-vof");
    if (!id) {
      id = `vof-${next}`;
      el.setAttribute("data-vof", id);
      next += 1;
    }
    return id;
  };
}
