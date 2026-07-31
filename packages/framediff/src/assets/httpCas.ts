// A CAS backed by a plain HTTP folder endpoint (GET/HEAD/PUT <base>/<hash>) — in dev, a tiny vite
// middleware persists the bytes into a configurable local folder (`framediff-cache/` by default),
// so baked artifacts land as
// real files on disk and survive reloads. Same interface as MemoryCAS; no backend required.

import type { Hash } from "../graph/hash";
import type { CAS } from "./cas";

type HttpRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class HttpFolderCAS implements CAS {
  constructor(
    private base: string = "/__framediff-cache",
    private request: HttpRequest = globalThis.fetch.bind(globalThis),
  ) {}
  private url(hash: Hash): string {
    // hashes look like "blake3:ab12…" / "sha256:…" — keep them filesystem-safe
    return `${this.base}/${encodeURIComponent(hash)}`;
  }
  async has(hash: Hash): Promise<boolean> {
    try {
      return (await this.request(this.url(hash), { method: "HEAD" })).ok;
    } catch {
      return false;
    }
  }
  async get(hash: Hash): Promise<Blob | null> {
    try {
      const r = await this.request(this.url(hash));
      return r.ok ? await r.blob() : null;
    } catch {
      return null;
    }
  }
  async put(hash: Hash, blob: Blob, name?: string): Promise<void> {
    const url = name ? `${this.url(hash)}?name=${encodeURIComponent(name)}` : this.url(hash);
    await this.request(url, { method: "PUT", body: blob });
  }
}
