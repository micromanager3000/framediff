// Resolve an asset reference to bytes. `asset://<uuid>` (or a bare UUID in the manifest) → manifest
// `contentHash` → CAS hit, else fetch each `sources[]` in order, **verify the hash on arrival**, store
// in the CAS. A raw URL/path (`/public/clip.mp4`, `blob:…`) passes through unchanged (back-compat).
// The hash check is the integrity guarantee — it makes an untrusted source safe for *content*.

import { hashBlob, type Hash } from "../graph/hash";
import { type CAS, MemoryCAS } from "./cas";
import type { AssetManifest } from "../graph/schemas";

export interface ResolvedAsset {
  ref: string;
  /** null for a raw passthrough URL. */
  contentHash: Hash | null;
  /** null for a raw passthrough URL or a trusted manifest source URL. */
  blob: Blob | null;
  /** a URL the media elements / MediaBunny can fetch (object URL for resolved assets, or the raw ref). */
  url: string;
  mime?: string;
}

export interface AssetResolverOptions {
  manifest?: AssetManifest;
  cas?: CAS;
  fetchImpl?: typeof fetch;
  /** make an object URL for a blob (browser). Omitted in node/tests → url is "". */
  makeObjectURL?: (b: Blob) => string;
  /** Use local dev CAS URLs directly instead of materializing large files into JS blobs. */
  trustLocalCacheSources?: boolean;
}

export interface AssetResolver {
  resolve(ref: string): Promise<ResolvedAsset>;
  /** Synchronous hit for refs that have already been resolved/preloaded. */
  peek(ref: string): ResolvedAsset | undefined;
  /** Resolve every asset in the manifest up front; useful for frame-tight export loops. */
  preloadAll(): Promise<void>;
  readonly cas: CAS;
  readonly manifest?: AssetManifest;
}

export function createAssetResolver(opts: AssetResolverOptions = {}): AssetResolver {
  const { manifest } = opts;
  const cas = opts.cas ?? new MemoryCAS();
  const doFetch = opts.fetchImpl ?? fetch;
  const makeURL = opts.makeObjectURL ?? ((b: Blob) => (typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(b) : ""));
  const localCacheSource = (sources: string[]) =>
    sources.find((source) => {
      try {
        const url = new URL(source, typeof location !== "undefined" ? location.href : "http://localhost");
        return url.pathname.startsWith("/__framediff-cache/");
      } catch {
        return source.startsWith("/__framediff-cache/");
      }
    });
  const resolved = new Map<string, ResolvedAsset>();
  const pending = new Map<string, Promise<ResolvedAsset>>();

  const idFor = (ref: string): string | null => {
    if (ref.startsWith("asset://")) return ref.slice("asset://".length);
    if (manifest && Object.prototype.hasOwnProperty.call(manifest.assets, ref)) return ref;
    return null;
  };

  const keyForId = (id: string) => `asset://${id}`;

  async function resolveById(id: string): Promise<ResolvedAsset> {
    const entry = manifest?.assets[id];
    if (!entry) throw new Error(`Unknown asset: "${id}" (not in manifest)`);

    const trusted = opts.trustLocalCacheSources ? localCacheSource(entry.sources) : undefined;
    if (trusted) {
      return { ref: `asset://${id}`, contentHash: entry.contentHash, blob: null, url: trusted, mime: entry.mime };
    }

    let blob = await cas.get(entry.contentHash);
    if (!blob) {
      let lastErr: unknown = "no sources";
      for (const source of entry.sources) {
        try {
          const res = await doFetch(source);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const b = await res.blob();
          const got = await hashBlob(b);
          if (got !== entry.contentHash) throw new Error(`hash mismatch from ${source}: got ${got}, want ${entry.contentHash}`);
          await cas.put(entry.contentHash, b);
          blob = b;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!blob) throw new Error(`Could not resolve asset "${id}" from sources: ${String(lastErr)}`);
    }
    return { ref: `asset://${id}`, contentHash: entry.contentHash, blob, url: makeURL(blob), mime: entry.mime };
  }

  async function resolveRef(ref: string): Promise<ResolvedAsset> {
    const id = idFor(ref);
    if (id) {
      const key = keyForId(id);
      const hit = resolved.get(key);
      if (hit) return hit;
      let p = pending.get(key);
      if (!p) {
        p = resolveById(id)
          .then((asset) => {
            resolved.set(key, asset);
            pending.delete(key);
            return asset;
          })
          .catch((err) => {
            pending.delete(key);
            throw err;
          });
        pending.set(key, p);
      }
      return p;
    }
    return { ref, contentHash: null, blob: null, url: ref };
  }

  return {
    cas,
    manifest,
    peek(ref: string): ResolvedAsset | undefined {
      const id = idFor(ref);
      return id ? resolved.get(keyForId(id)) : { ref, contentHash: null, blob: null, url: ref };
    },
    async preloadAll(): Promise<void> {
      if (!manifest) return;
      await Promise.all(Object.keys(manifest.assets).map((id) => resolveRef(`asset://${id}`)));
    },
    resolve: resolveRef,
  };
}

export async function preloadAssetResolver(resolver?: AssetResolver): Promise<void> {
  await resolver?.preloadAll();
}
