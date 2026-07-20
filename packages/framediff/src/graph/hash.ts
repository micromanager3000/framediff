// Content/address hashing. Uses WebCrypto SHA-256 — native in both the browser and Node 18+ (so it's
// unit-testable), and the zero-dependency fallback the design doc names. The algorithm is encoded in
// the hash string ("sha256:…") and folded into fingerprints via `recipeVersion`, so an address can
// never silently change meaning. A streaming BLAKE3 path can swap in later behind this same surface.

import { canonicalJSON } from "./canonicalJSON";

/** A content address or cache key, e.g. "sha256:ab12…". */
export type Hash = string;

function hex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

export async function hashBytes(data: BufferSource): Promise<Hash> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return "sha256:" + hex(new Uint8Array(digest));
}

export async function hashString(s: string): Promise<Hash> {
  return hashBytes(new TextEncoder().encode(s));
}

/** Hash the canonical form of a JSON-able value (stable across key order). */
export async function hashCanonical(value: unknown): Promise<Hash> {
  return hashString(canonicalJSON(value));
}

/** Stream a Blob through the digest without loading it fully into memory (large source assets). */
export async function hashBlob(blob: Blob): Promise<Hash> {
  // WebCrypto has no incremental digest; ReadableStream→ArrayBuffer keeps peak memory to one buffer.
  // (BLAKE3's true streaming hash is the intended upgrade for multi-GB inputs.)
  return hashBytes(await blob.arrayBuffer());
}
