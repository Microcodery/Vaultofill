// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createPasswordPrompt } from "../../../src/ext/panel/passwordPrompt";

describe("createPasswordPrompt", () => {
  it("resolves with the entered password on submit", async () => {
    const host = document.createElement("div");
    const prompt = createPasswordPrompt(host);
    const pending = prompt({});

    const input = host.querySelector<HTMLInputElement>(".vof-unlock-input")!;
    input.value = "hunter2";
    host.querySelector<HTMLFormElement>("form")!.requestSubmit();

    expect(await pending).toBe("hunter2");
    expect(host.hidden).toBe(true);
    expect(host.innerHTML).toBe(""); // torn down after resolving
  });

  it("resolves with null when cancelled", async () => {
    const host = document.createElement("div");
    const prompt = createPasswordPrompt(host);
    const pending = prompt({});

    const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
    cancel.click();
    expect(await pending).toBeNull();
  });

  it("shows the error message on a re-prompt", async () => {
    const host = document.createElement("div");
    const prompt = createPasswordPrompt(host);
    void prompt({ error: "Incorrect password" });
    expect(host.querySelector(".vof-unlock-error")!.textContent).toBe("Incorrect password");
    expect(host.querySelector(".vof-unlock-error")!.getAttribute("role")).toBe("alert");
  });
});
