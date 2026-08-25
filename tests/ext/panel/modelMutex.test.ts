import { describe, it, expect } from "vitest";
import { createModelMutex } from "../../../src/ext/panel/modelMutex";
import { ModelClient, CompletionRequest } from "../../../src/core/planner/modelClient";

/** A client whose complete() resolves only when the test releases it, recording
 *  entry/exit order so we can prove calls don't overlap. */
function makeControllable() {
  const events: string[] = [];
  const releases: Array<() => void> = [];
  let active = 0;
  const client: ModelClient = {
    complete: <T>(req: CompletionRequest): Promise<T> => {
      const id = (req as unknown as { id: string }).id;
      active++;
      events.push(`enter ${id} (active=${active})`);
      return new Promise<T>((resolve) => {
        releases.push(() => {
          events.push(`exit ${id}`);
          active--;
          resolve(id as unknown as T);
        });
      });
    },
  };
  return { client, events, releases };
}

const req = (id: string): CompletionRequest =>
  ({ system: "", messages: [], supportsGrammar: false, id }) as unknown as CompletionRequest;

describe("createModelMutex", () => {
  it("runs wrapped completions one at a time even when fired concurrently", async () => {
    const { client, events, releases } = makeControllable();
    const wrapped = createModelMutex().wrap(client);

    const p1 = wrapped.complete(req("a"));
    const p2 = wrapped.complete(req("b"));
    await Promise.resolve(); // let the chain settle its first .then

    // Only the first has entered; the second is queued.
    expect(events).toEqual(["enter a (active=1)"]);

    releases[0]!(); // finish a → b may start
    await p1;
    await Promise.resolve();
    releases[1]!();
    await p2;

    expect(events).toEqual(["enter a (active=1)", "exit a", "enter b (active=1)", "exit b"]);
  });

  it("a rejected completion does not poison the queue for later ones", async () => {
    let call = 0;
    const client: ModelClient = {
      complete: <T>(): Promise<T> => (++call === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("ok" as unknown as T)),
    };
    const wrapped = createModelMutex().wrap(client);
    await expect(wrapped.complete(req("x"))).rejects.toThrow("boom");
    await expect(wrapped.complete(req("y"))).resolves.toBe("ok");
  });
});
