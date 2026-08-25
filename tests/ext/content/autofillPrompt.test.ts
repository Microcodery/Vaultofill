// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { installAutofillPrompt, PROMPT_ID, HIDE_DELAY_MS } from "../../../src/ext/content/autofillPrompt";

// One shared install: installAutofillPrompt attaches document-level listeners,
// and the shared jsdom document would accumulate them across repeated installs.
const onTrigger = vi.fn();

beforeAll(() => {
  vi.useFakeTimers();
  installAutofillPrompt(document, onTrigger);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  onTrigger.mockClear();
  // Escape hides the prompt and cancels any pending hide timer.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  document.body.innerHTML = `
    <input id="field" name="email">
    <button id="btn" type="button">Other</button>
  `;
});

const field = () => document.getElementById("field")!;
const prompt = () => document.getElementById(PROMPT_ID) as HTMLButtonElement;

function focusIn(el: Element): void {
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

function focusOut(el: Element): void {
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

describe("installAutofillPrompt", () => {
  it("shows the prompt when a meaningful fillable field gains focus", () => {
    focusIn(field());

    expect(prompt().style.display).toBe("block");
    expect(prompt().textContent).toBe("Autofill the entire page?");
    expect(prompt().parentElement).toBe(document.documentElement);
  });

  it("hides when a non-fillable element gains focus", () => {
    focusIn(field());
    focusIn(document.getElementById("btn")!);

    expect(prompt().style.display).toBe("none");
  });

  it("fires onTrigger and hides when clicked", () => {
    focusIn(field());
    prompt().click();

    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(prompt().style.display).toBe("none");
  });

  it("prevents default on mousedown so the field keeps focus until the click lands", () => {
    focusIn(field());
    const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    prompt().dispatchEvent(mousedown);

    expect(mousedown.defaultPrevented).toBe(true);
    expect(prompt().style.display).toBe("block");
  });

  it("hides HIDE_DELAY_MS after the active field loses focus", () => {
    focusIn(field());
    focusOut(field());

    vi.advanceTimersByTime(HIDE_DELAY_MS - 1);
    expect(prompt().style.display).toBe("block");
    vi.advanceTimersByTime(1);
    expect(prompt().style.display).toBe("none");
  });

  it("cancels the pending hide when the field is refocused within the delay", () => {
    focusIn(field());
    focusOut(field());
    vi.advanceTimersByTime(HIDE_DELAY_MS - 50);
    focusIn(field());
    vi.advanceTimersByTime(HIDE_DELAY_MS * 10);

    expect(prompt().style.display).toBe("block");
  });

  it("ignores focusout from an element that is not the active field", () => {
    focusIn(field());
    focusOut(document.getElementById("btn")!);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 10);

    expect(prompt().style.display).toBe("block");
  });

  it("hides on Escape, scroll, and an outside click", () => {
    focusIn(field());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(prompt().style.display).toBe("none");

    focusIn(field());
    window.dispatchEvent(new Event("scroll"));
    expect(prompt().style.display).toBe("none");

    focusIn(field());
    document.getElementById("btn")!.click();
    expect(prompt().style.display).toBe("none");
  });

  it("does not hide when the active field itself is clicked", () => {
    focusIn(field());
    (field() as HTMLElement).click();

    expect(prompt().style.display).toBe("block");
  });
});
