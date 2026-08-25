const MEANINGFUL_INPUT_TYPES = new Set([
  "text", "email", "tel", "url", "number", "password",
  "date", "month", "week", "time", "datetime-local"
]);

function isSearchField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;

  // type="search"
  if (el.type === "search") return true;

  // Check if inside [role="search"]
  if (el.closest("[role=\"search\"]")) return true;

  // Check if inside <form role="search">
  const formParent = el.closest("form");
  if (formParent && formParent.getAttribute("role") === "search") return true;

  // Check name/id/aria-label/placeholder for "search" (case-insensitive)
  const name = (el.name || "").toLowerCase();
  const id = (el.id || "").toLowerCase();
  const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
  const placeholder = (el.placeholder || "").toLowerCase();

  return name.includes("search") || id.includes("search") ||
         ariaLabel.includes("search") || placeholder.includes("search");
}

/**
 * True iff `el` is a fillable field type (select/textarea, or an input of
 * type text|email|tel|url|number|password|date|month|week|time|datetime-local,
 * with missing/empty type treated as text) AND is not a search field
 * (type="search", name/id/aria-label/placeholder containing "search",
 * or inside [role="search"] or <form role="search">).
 */
export function isMeaningfulFillableField(el: Element): boolean {
  const isFillableType =
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && MEANINGFUL_INPUT_TYPES.has((el.type || "text").toLowerCase()));

  if (!isFillableType) return false;

  return !isSearchField(el);
}
