import { isMeaningfulFillableField } from "../../core/form/fieldDetect";

export const PROMPT_ID = "vaultofill-autofill-prompt";
export const HIDE_DELAY_MS = 150;

/**
 * Install the in-page "Autofill the entire page?" prompt: it appears under a
 * meaningful fillable field on focus, fires `onTrigger` when pressed, and hides
 * on focusout (after a short grace delay), Escape, scroll, resize, or an
 * outside click.
 */
export function installAutofillPrompt(doc: Document, onTrigger: () => void): void {
  let promptEl: HTMLButtonElement | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let activeField: Element | undefined;

  function getPromptEl(): HTMLButtonElement {
    const existing = doc.getElementById(PROMPT_ID);
    if (existing instanceof HTMLButtonElement) {
      promptEl = existing;
      return existing;
    }

    const prompt = doc.createElement("button");
    prompt.id = PROMPT_ID;
    prompt.type = "button";
    prompt.textContent = "Autofill the entire page?";
    Object.assign(prompt.style, {
      position: "fixed",
      zIndex: "2147483647",
      padding: "6px 12px",
      background: "#4b5563",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      font: "600 12px system-ui, sans-serif",
      cursor: "pointer",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    // Prevent the field from losing focus when the prompt is pressed, so
    // focusout doesn't fire (and hide the prompt) before the click lands.
    prompt.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    prompt.addEventListener("click", () => {
      onTrigger();
      hidePrompt();
    });

    doc.documentElement.appendChild(prompt);
    promptEl = prompt;
    return prompt;
  }

  function cancelHide(): void {
    if (hideTimer !== undefined) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  }

  function hidePrompt(): void {
    cancelHide();
    activeField = undefined;
    if (promptEl) promptEl.style.display = "none";
  }

  function scheduleHide(): void {
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      hidePrompt();
    }, HIDE_DELAY_MS);
  }

  function showPromptFor(field: Element): void {
    const prompt = getPromptEl();
    cancelHide();
    activeField = field;

    const rect = field.getBoundingClientRect();
    prompt.style.display = "block";
    prompt.style.top = `${rect.bottom + 4}px`;
    prompt.style.left = `${rect.left}px`;
  }

  doc.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.id === PROMPT_ID) return;
    if (isMeaningfulFillableField(target)) {
      showPromptFor(target);
    } else {
      hidePrompt();
    }
  });

  doc.addEventListener("focusout", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target !== activeField) return;
    scheduleHide();
  });

  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePrompt();
  });

  doc.defaultView?.addEventListener("scroll", () => hidePrompt(), true);
  doc.defaultView?.addEventListener("resize", () => hidePrompt());

  doc.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.id === PROMPT_ID || target === activeField) return;
    hidePrompt();
  });
}
