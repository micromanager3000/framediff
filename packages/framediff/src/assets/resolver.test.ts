import { describe, it, expect } from "vitest";
import { createAssetResolver } from "./resolver";
import { hashBlob } from "../graph/hash";
import type { AssetManifest } from "../graph/schemas";

async function manifestFor(bytes: Uint8Array, sources: string[]): Promise<{ manifest: AssetManifest; contentHash: string }> {
  const blob = new Blob([bytes.buffer as ArrayBuffer]);
  const contentHash = await hashBlob(blob);
  return {
    contentHash,
    manifest: { version: 1, assets: { u: { name: "x", contentHash, mime: "application/octet-stream", bytes: blob.size, sources } } },
  };
}

describe("asset resolver", () => {
  it("passes raw URLs through unchanged", async () => {
    const r = createAssetResolver();
    const a = await r.resolve("/public/clip.mp4");
    expect(a.url).toBe("/public/clip.mp4");
    expect(a.contentHash).toBeNull();
  });

  it("resolves asset://id, verifies the hash, and caches (no second fetch)", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { manifest, contentHash } = await manifestFor(bytes, ["https://x/blob"]);
    let fetches = 0;
    const r = createAssetResolver({ manifest, makeObjectURL: () => "blob:x", fetchImpl: async () => { fetches++; return new Response(bytes); } });
    const a = await r.resolve("asset://u");
    expect(a.contentHash).toBe(contentHash);
    expect(fetches).toBe(1);
    await r.resolve("asset://u");
    expect(fetches).toBe(1); // CAS hit, no refetch
  });

  it("preloads manifest assets so later lookups can synchronously peek object URLs", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { manifest, contentHash } = await manifestFor(bytes, ["https://x/blob"]);
    const r = createAssetResolver({
      manifest,
      makeObjectURL: () => "blob:preloaded",
      fetchImpl: async () => new Response(bytes),
    });

    expect(r.peek("asset://u")).toBeUndefined();
    await r.preloadAll();

    expect(r.peek("asset://u")).toMatchObject({ contentHash, url: "blob:preloaded" });
    expect(r.peek("u")).toMatchObject({ contentHash, url: "blob:preloaded" });
  });

  it("can trust local dev-cache source URLs without fetching blobs", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { manifest, contentHash } = await manifestFor(bytes, ["/__framediff-cache/sha256%3Aabc"]);
    let fetches = 0;
    const r = createAssetResolver({
      manifest,
      trustLocalCacheSources: true,
      fetchImpl: async () => {
        fetches++;
        return new Response(bytes);
      },
    });

    await r.preloadAll();

    expect(fetches).toBe(0);
    expect(r.peek("asset://u")).toMatchObject({
      contentHash,
      blob: null,
      url: "/__framediff-cache/sha256%3Aabc",
    });
  });

  it("rejects corrupt bytes (hash mismatch)", async () => {
    const { manifest } = await manifestFor(new Uint8Array([1, 2, 3, 4]), ["https://x/blob"]);
    const r = createAssetResolver({ manifest, fetchImpl: async () => new Response(new Uint8Array([9, 9, 9, 9])) });
    await expect(r.resolve("asset://u")).rejects.toThrow(/mismatch/);
  });

  it("falls back to the next source on failure", async () => {
    const bytes = new Uint8Array([5, 6, 7, 8]);
    const { manifest, contentHash } = await manifestFor(bytes, ["https://bad", "https://good"]);
    const r = createAssetResolver({
      manifest,
      makeObjectURL: () => "blob:y",
      fetchImpl: async (u) => { if (String(u).includes("bad")) throw new Error("net"); return new Response(bytes); },
    });
    expect((await r.resolve("asset://u")).contentHash).toBe(contentHash);
  });

  it("throws on an unknown asset id", async () => {
    const r = createAssetResolver({ manifest: { version: 1, assets: {} } });
    await expect(r.resolve("asset://nope")).rejects.toThrow(/Unknown asset/);
  });
});
