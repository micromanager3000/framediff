// Deterministic JSON: object keys sorted recursively, `undefined` dropped, non-finite numbers and
// unserializable values rejected. Two structurally-equal values always produce the same string, so
// it's a safe input to hashing/fingerprinting (the same composition always hashes the same).

function canonicalize(v: unknown): unknown {
  if (v === null) return null;
  const t = typeof v;
  if (t === "number") {
    if (!Number.isFinite(v as number)) throw new Error(`canonicalJSON: non-finite number (${String(v)})`);
    return v;
  }
  if (t === "string" || t === "boolean") return v;
  if (t === "bigint") return (v as bigint).toString();
  if (t === "undefined" || t === "function" || t === "symbol") {
    throw new Error(`canonicalJSON: unserializable value of type "${t}"`);
  }
  if (Array.isArray(v)) return v.map(canonicalize);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] === undefined) continue; // drop, don't serialize as null
    out[k] = canonicalize(obj[k]);
  }
  return out;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
