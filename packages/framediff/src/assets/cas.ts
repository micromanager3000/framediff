// A content-addressed store: bytes keyed by their hash. The resolver writes verified bytes here and
// reads them back on a cache hit. MemoryCAS is the default (per-session); a persistent backend
// (IndexedDB / File System Access per PRD §9.1, or ~/.framediff/cache for a CLI) implements the same
// interface and swaps in without touching the resolver.

import type { Hash } from "../graph/hash";

export interface CAS {
  has(hash: Hash): Promise<boolean>;
  get(hash: Hash): Promise<Blob | null>;
  put(hash: Hash, blob: Blob): Promise<void>;
}

export class MemoryCAS implements CAS {
  private store = new Map<Hash, Blob>();
  async has(hash: Hash): Promise<boolean> {
    return this.store.has(hash);
  }
  async get(hash: Hash): Promise<Blob | null> {
    return this.store.get(hash) ?? null;
  }
  async put(hash: Hash, blob: Blob): Promise<void> {
    this.store.set(hash, blob);
  }
}
