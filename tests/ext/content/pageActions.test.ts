// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findByVofId,
  fill,
  setChecked,
  highlight,
  clickSubmit,
  handleMessage,
} from "../../../src/ext/content/pageActions";

beforeEach(() => {
  document.body.innerHTML = "";
});

function recordEvents(el: Element): string[] {
  const seen: string[] = [];
  for (const type of ["input", "change"]) {
    el.addEventListener(type, (e) => {
      expect(e.bubbles).toBe(true);
      seen.push(e.type);
    });
  }
  return seen;
}

describe("findByVofId", () => {
  it("returns the element tagged with the data-vof id", () => {
    document.body.innerHTML = `<input data-vof="vof-3">`;
    expect(findByVofId("vof-3")).toBe(document.querySelector("input"));
  });

  it("throws when no element carries the id", () => {
    expect(() => findByVofId("vof-9")).toThrow('No element found for data-vof="vof-9"');
  });
});

describe("fill", () => {
  it("sets an input's value and dispatches input then change", () => {
    document.body.innerHTML = `<input data-vof="vof-0">`;
    const input = document.querySelector("input")!;
    const seen = recordEvents(input);

    fill("vof-0", "Ada");

    expect(input.value).toBe("Ada");
    expect(seen).toEqual(["input", "change"]);
  });

  it("commits a select's value and dispatches change (selects ignore input)", () => {
    document.body.innerHTML = `
      <select data-vof="vof-0">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    `;
    const select = document.querySelector("select")!;
    const seen = recordEvents(select);

    fill("vof-0", "b");

    expect(select.value).toBe("b");
    expect(seen).toEqual(["input", "change"]);
  });

  it("sets textContent on a non-form element and dispatches only input", () => {
    document.body.innerHTML = `<div data-vof="vof-0" contenteditable="true"></div>`;
    const div = document.querySelector("div")!;
    const seen = recordEvents(div);

    fill("vof-0", "hello");

    expect(div.textContent).toBe("hello");
    expect(seen).toEqual(["input"]);
  });
});

describe("setChecked", () => {
  it("checks a radio and dispatches input then change", () => {
    document.body.innerHTML = `<input type="radio" data-vof="vof-0" name="bed" value="king">`;
    const radio = document.querySelector("input")!;
    const seen = recordEvents(radio);

    setChecked("vof-0", true);

    expect(radio.checked).toBe(true);
    expect(seen).toEqual(["input", "change"]);
  });

  it("checks and unchecks a checkbox", () => {
    document.body.innerHTML = `<input type="checkbox" data-vof="vof-0" checked>`;
    const box = document.querySelector("input")!;

    setChecked("vof-0", false);
    expect(box.checked).toBe(false);
    setChecked("vof-0", true);
    expect(box.checked).toBe(true);
  });

  it("ignores non-input elements without throwing", () => {
    document.body.innerHTML = `<div data-vof="vof-0"></div>`;
    const div = document.querySelector("div")!;
    const seen = recordEvents(div);

    setChecked("vof-0", true);

    expect(seen).toEqual([]);
  });
});

describe("highlight", () => {
  it("sets a 2px solid outline in the given color", () => {
    document.body.innerHTML = `<input data-vof="vof-0">`;
    highlight("vof-0", "red");
    expect(document.querySelector("input")!.style.outline).toBe("2px solid red");
  });
});

describe("clickSubmit", () => {
  it("clicks the tagged element", () => {
    document.body.innerHTML = `<button data-vof="vof-0">Go</button>`;
    const onClick = vi.fn();
    document.querySelector("button")!.addEventListener("click", onClick);

    clickSubmit("vof-0");

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("handleMessage", () => {
  it("responds to ping", async () => {
    await expect(handleMessage({ action: "ping", args: [] })).resolves.toEqual({ ok: true });
  });

  it("readForm returns swept fields plus a submit spec seeded past the field ids", async () => {
    document.body.innerHTML = `
      <form>
        <label for="fn">First name</label>
        <input id="fn" name="first">
        <input type="email" name="email" placeholder="Email">
        <button type="submit">Send</button>
      </form>
    `;

    const result = (await handleMessage({ action: "readForm", args: [] })) as {
      fields: { humanReadable: string; elementId: string }[];
      submit: { kind: string; elementId: string } | null;
    };

    expect(result.fields.map((f) => f.humanReadable)).toEqual(["First name", "Email"]);
    expect(result.fields.map((f) => f.elementId)).toEqual(["vof-0", "vof-1"]);
    expect(result.submit).toEqual({ kind: "dom", elementId: "vof-2" });
  });

  it("fieldCount returns the non-mutating fillable count", async () => {
    document.body.innerHTML = `
      <input name="first" placeholder="First">
      <input type="email" name="email" placeholder="Email">
    `;

    await expect(handleMessage({ action: "fieldCount", args: [] })).resolves.toBe(2);
    expect(document.querySelector("[data-vof]")).toBeNull();
  });

  it("routes fill, setChecked, highlight, and clickSubmit, returning undefined", async () => {
    document.body.innerHTML = `
      <input data-vof="vof-0">
      <input type="checkbox" data-vof="vof-1">
      <input data-vof="vof-2">
      <button data-vof="vof-3">Go</button>
    `;
    const onClick = vi.fn();
    document.querySelector("button")!.addEventListener("click", onClick);

    await expect(handleMessage({ action: "fill", args: ["vof-0", "x"] })).resolves.toBeUndefined();
    await expect(handleMessage({ action: "setChecked", args: ["vof-1", true] })).resolves.toBeUndefined();
    await expect(handleMessage({ action: "highlight", args: ["vof-2", "lime"] })).resolves.toBeUndefined();
    await expect(handleMessage({ action: "clickSubmit", args: ["vof-3"] })).resolves.toBeUndefined();

    expect(document.querySelector<HTMLInputElement>('[data-vof="vof-0"]')!.value).toBe("x");
    expect(document.querySelector<HTMLInputElement>('[data-vof="vof-1"]')!.checked).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-vof="vof-2"]')!.style.outline).toBe("2px solid lime");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown action", async () => {
    await expect(handleMessage({ action: "nope", args: [] })).rejects.toThrow("Unknown action: nope");
  });
});
