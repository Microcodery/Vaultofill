import { describe, it, expect } from "vitest";
import { TabReviewStore, SerializedTabReview } from "../../../src/ext/panel/tabReviewStore";
import { FilledEntry } from "../../../src/core/types";

class FakeArea {
  store: Record<string, unknown> = {};
  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.store ? { [key]: this.store[key] } : {};
  }
  async set(obj: Record<string, unknown>): Promise<void> {
    Object.assign(this.store, obj);
  }
}

const entry = (label: string, value: string): FilledEntry => ({
  field: { label, humanReadable: label, elementId: "e1" },
  value,
  confidence: "certain",
});

const review = (domain: string, ...entries: FilledEntry[]): SerializedTabReview => ({
  domain,
  entries,
  submit: { kind: "dom", elementId: "sub" },
  status: "Filled & saved.",
});

describe("TabReviewStore", () => {
  it("round-trips a saved review keyed by numeric tabId", async () => {
    const store = new TabReviewStore(new FakeArea());
    await store.save(7, review("site.com", entry("EMAIL", "a@b.com")));
    const all = await store.loadAll();
    expect(all.get(7)?.domain).toBe("site.com");
    expect(all.get(7)?.entries[0]?.value).toBe("a@b.com");
    expect(all.get(7)?.submit).toEqual({ kind: "dom", elementId: "sub" });
  });

  it("save overwrites the same tab and keeps others", async () => {
    const store = new TabReviewStore(new FakeArea());
    await store.save(1, review("a.com", entry("EMAIL", "old")));
    await store.save(2, review("b.com", entry("NAME", "Ada")));
    await store.save(1, review("a.com", entry("EMAIL", "new")));
    const all = await store.loadAll();
    expect(all.get(1)?.entries[0]?.value).toBe("new");
    expect(all.get(2)?.entries[0]?.value).toBe("Ada");
    expect([...all.keys()].sort()).toEqual([1, 2]);
  });

  it("remove drops one tab; unknown remove is a no-op", async () => {
    const store = new TabReviewStore(new FakeArea());
    await store.save(1, review("a.com"));
    await store.save(2, review("b.com"));
    await store.remove(1);
    await store.remove(99); // no throw
    const all = await store.loadAll();
    expect([...all.keys()]).toEqual([2]);
  });

  it("pruneTo keeps only live tabs", async () => {
    const store = new TabReviewStore(new FakeArea());
    await store.save(1, review("a.com"));
    await store.save(2, review("b.com"));
    await store.save(3, review("c.com"));
    await store.pruneTo([2, 3, 42]);
    const all = await store.loadAll();
    expect([...all.keys()].sort()).toEqual([2, 3]);
  });

  it("loadAll on an empty area is an empty map; corrupt JSON degrades to empty", async () => {
    const area = new FakeArea();
    expect((await new TabReviewStore(area).loadAll()).size).toBe(0);
    area.store["vaultofill:tabReviews"] = "{not json";
    expect((await new TabReviewStore(area).loadAll()).size).toBe(0);
  });

  it("serializes concurrent saves so one tab's review can't clobber another's", async () => {
    // An area with an async gap between get and set: without serialization the two
    // read-modify-write cycles both read {} then the last set wins, losing a tab.
    class SlowArea {
      store: Record<string, unknown> = {};
      async get(key: string): Promise<Record<string, unknown>> {
        await Promise.resolve();
        return key in this.store ? { [key]: this.store[key] } : {};
      }
      async set(obj: Record<string, unknown>): Promise<void> {
        await Promise.resolve();
        Object.assign(this.store, obj);
      }
    }
    const store = new TabReviewStore(new SlowArea());
    await Promise.all([
      store.save(1, review("a.com", entry("EMAIL", "one"))),
      store.save(2, review("b.com", entry("NAME", "two"))),
    ]);
    const all = await store.loadAll();
    expect([...all.keys()].sort()).toEqual([1, 2]); // both survived
  });
});
