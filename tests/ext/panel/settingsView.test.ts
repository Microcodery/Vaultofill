// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderSettings, renderLabelRegistry } from "../../../src/ext/panel/settingsView";
import { Vault } from "../../../src/core/details/vault";
import { LabelRegistry } from "../../../src/core/labels/labelRegistry";

const D = (canonicalLabel: string, value: string, aliases: string[] = [], variant?: string) => ({
  canonicalLabel,
  value,
  aliases,
  variant,
  sensitivity: "private" as const,
  volatility: "stable" as const,
});

describe("renderSettings", () => {
  it("lists each label with its value and aliases", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com", ["email", "your email"]));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {});

    expect(container.querySelector(".vof-settings-label")!.textContent).toBe("Email");
    expect((container.querySelector(".vof-settings-value") as HTMLInputElement).value).toBe("a@b.com");
    expect([...container.querySelectorAll(".vof-alias-chip")].map((c) => c.textContent!.replace("✕", ""))).toEqual(["email", "your email"]);
  });

  it("deleting an alias removes it from the vault and persists (the wrong-mapping fix)", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com", ["email", "Cumulative GPA"])); // a mislabel that got learned
    const persist = vi.fn();
    const container = document.createElement("div");
    renderSettings(container, vault, persist, () => true);

    // Find the "Cumulative GPA" alias chip's delete button and click it.
    const chip = [...container.querySelectorAll(".vof-alias-chip")].find((c) => c.textContent!.includes("Cumulative GPA"))!;
    (chip.querySelector(".vof-icon-btn") as HTMLButtonElement).click();

    expect(vault.getByCanonical("EMAIL")!.aliases).toEqual(["email"]);
    expect(persist).toHaveBeenCalled();
  });

  it("cancelling the confirm aborts a delete (label/variant/alias untouched)", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com", ["email"]));
    const persist = vi.fn();
    const confirm = vi.fn(() => false); // user cancels every confirm
    const container = document.createElement("div");
    renderSettings(container, vault, persist, confirm);

    // Try deleting the label, its value, and its alias — all cancelled.
    (container.querySelector(".vof-settings-head .vof-icon-btn") as HTMLButtonElement).click();
    (container.querySelector(".vof-settings-variant .vof-icon-btn") as HTMLButtonElement).click();
    (container.querySelector(".vof-alias-chip .vof-icon-btn") as HTMLButtonElement).click();

    expect(confirm).toHaveBeenCalledTimes(3);
    expect(vault.getByCanonical("EMAIL")!.value).toBe("a@b.com"); // nothing removed
    expect(vault.getByCanonical("EMAIL")!.aliases).toEqual(["email"]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("editing a value updates the vault", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "old@b.com"));
    const persist = vi.fn();
    const container = document.createElement("div");
    renderSettings(container, vault, persist);

    const input = container.querySelector(".vof-settings-value") as HTMLInputElement;
    input.value = "new@b.com";
    input.dispatchEvent(new Event("change"));
    expect(vault.getByCanonical("EMAIL")!.value).toBe("new@b.com");
    expect(persist).toHaveBeenCalled();
  });

  it("deleting a label removes it entirely", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    vault.set(D("PHONE", "555"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {}, () => true);
    // Delete the first card's label (EMAIL sorts before PHONE).
    (container.querySelector(".vof-settings-head .vof-icon-btn") as HTMLButtonElement).click();
    expect(vault.keys()).toEqual(["PHONE"]);
  });

  it("renders each variant as its own value row; editing one leaves siblings untouched", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "me@home.com", ["email"], "personal"));
    vault.set(D("EMAIL", "me@work.com", [], "work"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {});
    const rows = [...container.querySelectorAll(".vof-settings-variant")];
    expect(rows.map((r) => r.querySelector(".vof-settings-vname")!.textContent)).toEqual(["personal", "work"]);

    const workValue = rows[1]!.querySelector(".vof-settings-value") as HTMLInputElement;
    workValue.value = "new@work.com";
    workValue.dispatchEvent(new Event("change"));
    expect(vault.getVariants("EMAIL").map((d) => d.value)).toEqual(["me@home.com", "new@work.com"]);
  });

  it("deleting a variant removes only that variant", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "me@home.com", [], "personal"));
    vault.set(D("EMAIL", "me@work.com", [], "work"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {}, () => true);
    const rows = [...container.querySelectorAll(".vof-settings-variant")];
    (rows[0]!.querySelector(".vof-icon-btn") as HTMLButtonElement).click(); // delete "personal"
    expect(vault.getVariants("EMAIL").map((d) => d.variant)).toEqual(["work"]);
  });

  it("adding an alias saves it and re-renders a chip for it", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com", ["email"]));
    const persist = vi.fn();
    const container = document.createElement("div");
    renderSettings(container, vault, persist);
    const input = container.querySelector(".vof-settings-addalias input") as HTMLInputElement;
    input.value = "work e-mail";
    (container.querySelector(".vof-settings-addalias button") as HTMLButtonElement).click();
    expect(vault.getByCanonical("EMAIL")!.aliases).toEqual(["email", "work e-mail"]);
    expect(persist).toHaveBeenCalled();
    expect([...container.querySelectorAll(".vof-alias-chip")].some((c) => c.textContent!.includes("work e-mail"))).toBe(true);
  });

  it("restores focus after a structural edit so keyboard users keep their place", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com", ["email", "e-mail"]));
    vault.set(D("PHONE", "555"));
    const container = document.createElement("div");
    document.body.appendChild(container); // focus needs a connected element in jsdom
    try {
      renderSettings(container, vault, () => {}, () => true);
      // Expand EMAIL, delete an alias → focus returns to EMAIL's expand button.
      const emailCard = container.querySelector('[data-card-label="EMAIL"]') as HTMLElement;
      (emailCard.querySelector(".vof-expand") as HTMLButtonElement).click();
      const chip = [...emailCard.querySelectorAll(".vof-alias-chip")].find((c) => c.textContent!.includes("e-mail"))!;
      (chip.querySelector(".vof-icon-btn") as HTMLButtonElement).click();
      expect(document.activeElement).toBe(container.querySelector('[data-card-label="EMAIL"] .vof-expand'));

      // Deleting the whole label falls back to the search box (the row is gone).
      (container.querySelector('[data-card-label="EMAIL"] .vof-settings-head .vof-icon-btn') as HTMLButtonElement).click();
      expect(document.activeElement).toBe(container.querySelector(".vof-settings-search"));
    } finally {
      container.remove();
    }
  });

  it("shows an empty state when the vault has no labels", () => {
    const container = document.createElement("div");
    renderSettings(container, new Vault(), () => {});
    expect(container.querySelector(".vof-settings-empty")).not.toBeNull();
  });

  it("collapses each row by default; the expand button (aria-expanded + aria-controls) toggles the details", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com", ["email"]));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {});

    const expand = container.querySelector(".vof-expand") as HTMLButtonElement;
    const body = container.querySelector(".vof-settings-body") as HTMLElement;
    expect(container.querySelector(".vof-settings-preview")!.textContent).toBe("a@b.com");
    expect(body.hidden).toBe(true); // collapsed by default
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(expand.getAttribute("aria-controls")).toBe(body.id); // points at the body it controls
    expect(body.id).toBeTruthy();

    expand.click();
    expect(body.hidden).toBe(false); // expanded
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expand.click();
    expect(body.hidden).toBe(true); // toggles back
    expect(expand.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking the delete button in the head deletes without expanding a surviving row", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    vault.set(D("PHONE", "555"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {}, () => true);
    (container.querySelector(".vof-settings-head .vof-icon-btn") as HTMLButtonElement).click();
    expect(vault.keys()).toEqual(["PHONE"]);
    // The surviving PHONE row is still collapsed — the delete click didn't toggle anything.
    expect((container.querySelector(".vof-settings-body") as HTMLElement).hidden).toBe(true);
  });

  it("editing the default value updates the collapsed preview live", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "old@b.com"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {});
    const input = container.querySelector(".vof-settings-value") as HTMLInputElement;
    input.value = "new@b.com";
    input.dispatchEvent(new Event("change"));
    expect(container.querySelector(".vof-settings-preview")!.textContent).toBe("new@b.com");
  });

  it("typing in the search box filters without re-rendering (same DOM nodes, caret preserved)", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    vault.set(D("PHONE", "555"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {});
    const valueNode = container.querySelector(".vof-settings-value");
    const search = container.querySelector(".vof-settings-search") as HTMLInputElement;
    search.value = "email";
    search.dispatchEvent(new Event("input"));
    // Same node instances survive (no rebuild), so focus/caret in the search box is kept.
    expect(container.querySelector(".vof-settings-value")).toBe(valueNode);
    expect(container.querySelector(".vof-settings-search")).toBe(search);
  });

  it("an expanded row that's filtered out hides entirely, and re-shows still expanded when the filter clears", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    vault.set(D("PHONE", "555"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {});
    const emailCard = [...container.querySelectorAll(".vof-settings-card")].find(
      (c) => c.querySelector(".vof-settings-label")!.textContent === "Email",
    ) as HTMLElement;
    (emailCard.querySelector(".vof-expand") as HTMLButtonElement).click(); // expand EMAIL
    const emailBody = emailCard.querySelector(".vof-settings-body") as HTMLElement;
    expect(emailBody.hidden).toBe(false);

    const search = container.querySelector(".vof-settings-search") as HTMLInputElement;
    search.value = "phone";
    search.dispatchEvent(new Event("input"));
    expect(emailCard.hidden).toBe(true); // whole card hidden, no floating body

    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(emailCard.hidden).toBe(false);
    expect(emailBody.hidden).toBe(false); // still expanded
  });

  it("search filters cards by label, value, or alias", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "ada@work.com", ["your email"]));
    vault.set(D("PHONE", "555-1234"));
    vault.set(D("CITY", "Portland"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {});

    const search = container.querySelector(".vof-settings-search") as HTMLInputElement;
    const cards = [...container.querySelectorAll(".vof-settings-card")] as HTMLElement[];
    const visible = (): string[] =>
      cards.filter((c) => !c.hidden).map((c) => c.querySelector(".vof-settings-label")!.textContent!);

    expect(visible()).toEqual(["City", "Email", "Phone"]); // all shown, sorted

    search.value = "port"; // matches CITY's value "Portland"
    search.dispatchEvent(new Event("input"));
    expect(visible()).toEqual(["City"]);

    search.value = "your email"; // matches EMAIL's alias
    search.dispatchEvent(new Event("input"));
    expect(visible()).toEqual(["Email"]);

    search.value = ""; // cleared → all again
    search.dispatchEvent(new Event("input"));
    expect(visible()).toEqual(["City", "Email", "Phone"]);
  });

  it("keeps a row expanded and the search query across a structural edit (alias delete)", () => {
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com", ["email", "e-mail"]));
    vault.set(D("PHONE", "555"));
    const container = document.createElement("div");
    renderSettings(container, vault, () => {}, () => true);

    // Search to EMAIL, expand it.
    const search = container.querySelector(".vof-settings-search") as HTMLInputElement;
    search.value = "email";
    search.dispatchEvent(new Event("input"));
    (container.querySelector(".vof-expand") as HTMLButtonElement).click();

    // Delete an alias (a structural edit → re-render).
    const chip = [...container.querySelectorAll(".vof-alias-chip")].find((c) => c.textContent!.includes("e-mail"))!;
    (chip.querySelector(".vof-icon-btn") as HTMLButtonElement).click();

    // Search query and the expanded state survive the re-render.
    expect((container.querySelector(".vof-settings-search") as HTMLInputElement).value).toBe("email");
    expect((container.querySelector(".vof-settings-body") as HTMLElement).hidden).toBe(false);
    const visibleLabels = ([...container.querySelectorAll(".vof-settings-card")] as HTMLElement[])
      .filter((c) => !c.hidden)
      .map((c) => c.querySelector(".vof-settings-label")!.textContent!);
    expect(visibleLabels).toEqual(["Email"]); // filter still applied
  });
});

describe("renderLabelRegistry", () => {
  const make = (): LabelRegistry => {
    const r = new LabelRegistry();
    r.learn("FAVORITE_COLOR", "What is your favorite color?");
    r.learn("FAVORITE_COLOR", "Preferred colour");
    r.learn("VEHICLE_MAKE", "Vehicle make");
    return r;
  };
  const cardLabels = (c: HTMLElement): string[] =>
    [...c.querySelectorAll(".vof-settings-label")].map((e) => e.textContent!);

  it("lists each learned label (humanized, sorted) with a phrasing count and read-only phrasings", () => {
    const container = document.createElement("div");
    renderLabelRegistry(container, make(), () => {});
    expect(cardLabels(container)).toEqual(["Favorite color", "Vehicle make"]);
    expect(container.querySelector(".vof-settings-preview")!.textContent).toBe("2 phrasings"); // FAVORITE_COLOR sorts first
    const chips = [...container.querySelectorAll(".vof-alias-chip")].map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(["What is your favorite color?", "Preferred colour", "Vehicle make"]));
    // Phrasings are read-only — no delete buttons on the chips.
    expect(container.querySelector(".vof-alias-chip .vof-icon-btn")).toBeNull();
  });

  it("shows an empty state when nothing has been learned", () => {
    const container = document.createElement("div");
    renderLabelRegistry(container, new LabelRegistry(), () => {});
    expect(container.querySelector(".vof-settings-empty")).not.toBeNull();
  });

  it("deleting a learned label (confirmed) forgets it and persists", () => {
    const registry = make();
    const persist = vi.fn();
    const container = document.createElement("div");
    renderLabelRegistry(container, registry, persist, () => true);
    (container.querySelector(".vof-settings-card .vof-icon-btn") as HTMLButtonElement).click(); // first = FAVORITE_COLOR
    expect(registry.entries().map((e) => e.name)).toEqual(["VEHICLE_MAKE"]);
    expect(persist).toHaveBeenCalled();
  });

  it("cancelling the confirm keeps the learned label", () => {
    const registry = make();
    const container = document.createElement("div");
    renderLabelRegistry(container, registry, () => {}, () => false);
    (container.querySelector(".vof-settings-card .vof-icon-btn") as HTMLButtonElement).click();
    expect(registry.entries().map((e) => e.name).sort()).toEqual(["FAVORITE_COLOR", "VEHICLE_MAKE"]);
  });

  it("search filters by label name or phrasing", () => {
    const container = document.createElement("div");
    renderLabelRegistry(container, make(), () => {});
    const cards = [...container.querySelectorAll(".vof-settings-card")] as HTMLElement[];
    const visible = (): string[] => cards.filter((c) => !c.hidden).map((c) => c.querySelector(".vof-settings-label")!.textContent!);
    expect(visible()).toEqual(["Favorite color", "Vehicle make"]);

    const search = container.querySelector(".vof-settings-search") as HTMLInputElement;
    search.value = "colour"; // matches the "Preferred colour" phrasing
    search.dispatchEvent(new Event("input"));
    expect(visible()).toEqual(["Favorite color"]);

    search.value = "vehicle";
    search.dispatchEvent(new Event("input"));
    expect(visible()).toEqual(["Vehicle make"]);
  });

  it("preserves the active search filter across a delete re-render", () => {
    const registry = make();
    registry.learn("VEHICLE_MODEL", "Vehicle model"); // a second "vehicle" match, so the filter is non-trivial
    const container = document.createElement("div");
    renderLabelRegistry(container, registry, () => {}, () => true);

    const search = container.querySelector(".vof-settings-search") as HTMLInputElement;
    search.value = "vehicle";
    search.dispatchEvent(new Event("input"));

    // Delete the first visible "vehicle" card (VEHICLE_MAKE sorts before VEHICLE_MODEL).
    const card = container.querySelector('[data-registry-label="VEHICLE_MAKE"]') as HTMLElement;
    (card.querySelector(".vof-icon-btn") as HTMLButtonElement).click();

    const search2 = container.querySelector(".vof-settings-search") as HTMLInputElement;
    expect(search2.value).toBe("vehicle"); // query survived the re-render
    const visibleLabels = [...container.querySelectorAll(".vof-settings-card")]
      .filter((c) => !(c as HTMLElement).hidden)
      .map((c) => c.querySelector(".vof-settings-label")!.textContent!);
    expect(visibleLabels).toEqual(["Vehicle model"]); // filter still applied, deleted card gone
  });

  it("falls back to the empty state when the last label is deleted", () => {
    const registry = new LabelRegistry();
    registry.learn("FAVORITE_COLOR", "Favorite color");
    const container = document.createElement("div");
    renderLabelRegistry(container, registry, () => {}, () => true);
    (container.querySelector(".vof-settings-card .vof-icon-btn") as HTMLButtonElement).click();
    expect(container.querySelector(".vof-settings-card")).toBeNull();
    expect(container.querySelector(".vof-settings-empty")).not.toBeNull();
  });
});
