/**
 * Render any thrown value as readable text. Errors expose name/message, but
 * library code (e.g. a web-llm worker) can reject with plain objects,
 * `undefined`, or DOM events — a Worker's `onerror` fires an `ErrorEvent` whose
 * useful fields are non-enumerable getters, so `${e.name}: ${e.message}` renders
 * "undefined: undefined" and `JSON.stringify` yields only `{"isTrusted":true}`.
 *
 * Contract: this NEVER throws. It runs inside catch blocks reporting other
 * failures, and its inputs are hostile (throwing getters, Proxies, null-proto
 * objects), so the whole body is guarded with a last-resort fallback.
 */
export function describeError(err: unknown): string {
  try {
    if (err instanceof Error) return err.message ? `${err.name}: ${err.message}` : err.name;
    if (typeof err === "string") return err;

    if (err !== null && typeof err === "object") {
      const e = err as {
        name?: unknown;
        message?: unknown;
        filename?: unknown;
        lineno?: unknown;
        error?: unknown;
        type?: unknown;
      };
      // An ErrorEvent often carries the real cause on `.error` (same-origin) …
      if (e.error instanceof Error) return describeError(e.error);
      // … or a `.message` (+ optional name and source location) via getters.
      if (typeof e.message === "string" && e.message) {
        const name = typeof e.name === "string" && e.name ? `${e.name}: ` : "";
        const loc =
          typeof e.filename === "string" && e.filename
            ? typeof e.lineno === "number"
              ? ` (${e.filename}:${e.lineno})`
              : ` (${e.filename})`
            : "";
        return `${name}${e.message}${loc}`;
      }
      try {
        const json = JSON.stringify(err);
        if (json && json !== "{}") {
          // A bare event (e.g. worker load failure) serializes to {"isTrusted":true};
          // prefix its type so it reads as an event, not an anonymous object.
          return typeof e.type === "string" ? `${e.type} event ${json}` : json;
        }
      } catch {
        /* non-serializable (circular, BigInt, …) — fall through to String() */
      }
      if (typeof e.type === "string") return `${e.type} event`;
    }
    return String(err);
  } catch {
    return "[unrenderable error value]";
  }
}
