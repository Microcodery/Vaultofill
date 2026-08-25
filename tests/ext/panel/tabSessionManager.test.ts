import { describe, it, expect } from "vitest";
import { TabSessionManager } from "../../../src/ext/panel/tabSessionManager";

interface FakeSession {
  tabId: number;
}

function makeManager() {
  const log: string[] = [];
  const created: number[] = [];
  const mgr = new TabSessionManager<FakeSession>({
    create: (tabId) => {
      created.push(tabId);
      return { tabId };
    },
    mount: (s) => log.push(`mount ${s.tabId}`),
    unmount: (s) => log.push(`unmount ${s.tabId}`),
    onEmpty: (tabId) => log.push(`empty ${tabId}`),
    destroy: (s) => log.push(`destroy ${s.tabId}`),
  });
  return { mgr, log, created };
}

describe("TabSessionManager", () => {
  it("ensure creates once and reuses; get/has reflect it", () => {
    const { mgr, created } = makeManager();
    const a = mgr.ensure(1);
    const b = mgr.ensure(1);
    expect(a).toBe(b);
    expect(created).toEqual([1]);
    expect(mgr.has(1)).toBe(true);
    expect(mgr.get(1)).toBe(a);
    expect(mgr.has(2)).toBe(false);
    expect(mgr.get(2)).toBeUndefined();
  });

  it("activate shows a placeholder when the active tab has no session", () => {
    const { mgr, log } = makeManager();
    mgr.activate(1);
    expect(log).toEqual(["empty 1"]);
    expect(mgr.currentTabId()).toBe(1);
    expect(mgr.isActive(1)).toBe(true);
  });

  it("activate mounts a tab's session and unmounts the previously active one", () => {
    const { mgr, log } = makeManager();
    mgr.ensure(1);
    mgr.ensure(2);
    mgr.activate(1);
    mgr.activate(2);
    expect(log).toEqual(["mount 1", "unmount 1", "mount 2"]);
  });

  it("activating the same tab after it gains a session mounts it (no spurious unmount)", () => {
    const { mgr, log } = makeManager();
    mgr.activate(1); // no session yet → placeholder
    mgr.ensure(1); // a read creates the session
    mgr.activate(1); // re-activate to reveal it
    expect(log).toEqual(["empty 1", "mount 1"]);
  });

  it("remove of the active session unmounts + destroys it and clears the active pointer", () => {
    const { mgr, log } = makeManager();
    mgr.ensure(1);
    mgr.activate(1);
    mgr.remove(1);
    expect(log).toEqual(["mount 1", "unmount 1", "destroy 1"]);
    expect(mgr.currentTabId()).toBeUndefined();
    expect(mgr.has(1)).toBe(false);
  });

  it("remove of a non-active session destroys it without touching the mounted one", () => {
    const { mgr, log } = makeManager();
    mgr.ensure(1);
    mgr.ensure(2);
    mgr.activate(1);
    mgr.remove(2);
    expect(log).toEqual(["mount 1", "destroy 2"]);
    expect(mgr.currentTabId()).toBe(1);
    expect(mgr.tabIds()).toEqual([1]);
  });

  it("remove of an unknown tab is a no-op", () => {
    const { mgr, log } = makeManager();
    mgr.remove(99);
    expect(log).toEqual([]);
  });
});
