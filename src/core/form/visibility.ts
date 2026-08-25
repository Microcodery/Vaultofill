const OFFSCREEN_THRESHOLD_PX = 9999;

function hasHiddenAttribute(el: Element): boolean {
  if (el instanceof HTMLElement && el.hidden) return true;
  return el.getAttribute("aria-hidden") === "true";
}

function isOffscreenPosition(style: CSSStyleDeclaration): boolean {
  if (style.position !== "absolute" && style.position !== "fixed") return false;
  const left = parseFloat(style.left);
  const top = parseFloat(style.top);
  return (
    (Number.isFinite(left) && Math.abs(left) >= OFFSCREEN_THRESHOLD_PX) ||
    (Number.isFinite(top) && Math.abs(top) >= OFFSCREEN_THRESHOLD_PX)
  );
}

function isHiddenByComputedStyle(view: Window, el: Element): boolean {
  const style = view.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return true;
  }
  return isOffscreenPosition(style);
}

function isRealLayoutEngine(view: Window | null): boolean {
  if (!view) return false;
  return !/jsdom/i.test(view.navigator.userAgent);
}

/**
 * True iff `el` is visible: neither it nor any ancestor is hidden via the
 * `hidden` attribute, `aria-hidden="true"`, or computed
 * display/visibility/opacity/off-screen-positioning. Falls back to
 * attribute-only checks when `doc` has no `defaultView` (e.g. a detached
 * document parsed via `DOMParser`, which jsdom never associates with a
 * browsing context and so never resolves stylesheet-based CSS for).
 */
export function isVisibleField(el: Element, doc: Document): boolean {
  const view = doc.defaultView;

  let current: Element | null = el;
  while (current) {
    if (hasHiddenAttribute(current)) return false;
    if (view && isHiddenByComputedStyle(view, current)) return false;
    current = current.parentElement;
  }

  if (isRealLayoutEngine(view) && el.getClientRects().length === 0) return false;

  return true;
}
