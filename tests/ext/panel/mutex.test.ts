import { describe, it, expect } from "vitest";
import { createMutex } from "../../../src/ext/panel/mutex";

describe("createMutex", () => {
  it("runs tasks one at a time, in submission order", async () => {
    const mutex = createMutex();
    const events: string[] = [];
    let active = 0;
    const task = (id: string) => async () => {
      active++;
      events.push(`start ${id} (active=${active})`);
      await Promise.resolve();
      active--;
      events.push(`end ${id}`);
    };
    await Promise.all([mutex.run(task("a")), mutex.run(task("b")), mutex.run(task("c"))]);
    expect(events).toEqual(["start a (active=1)", "end a", "start b (active=1)", "end b", "start c (active=1)", "end c"]);
  });

  it("a rejected task does not poison later tasks and returns each task's own result", async () => {
    const mutex = createMutex();
    await expect(mutex.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(mutex.run(() => Promise.resolve(42))).resolves.toBe(42);
  });
});
