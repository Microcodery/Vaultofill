export class JsonParseError extends Error { constructor(m: string) { super(m); this.name = "JsonParseError"; } }
export function decodeJson<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const objStart = cleaned.indexOf("{");
  const arrStart = cleaned.indexOf("[");
  let start: number;
  let close: string;
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    start = objStart;
    close = "}";
  } else if (arrStart !== -1) {
    start = arrStart;
    close = "]";
  } else {
    throw new JsonParseError(`no JSON value: ${raw.slice(0, 80)}`);
  }
  const end = cleaned.lastIndexOf(close);
  if (end < start) throw new JsonParseError(`no JSON value: ${raw.slice(0, 80)}`);
  try { return JSON.parse(cleaned.slice(start, end + 1)) as T; }
  catch (err) { throw new JsonParseError(`unparseable: ${(err as Error).message}`); }
}
