import { describe, expect, it } from "vitest";
import { __videoFramesTest } from "./videoFrames";

describe("VideoFrameSource source selection", () => {
  it("uses blob-backed decode for local FrameDiff cache URLs", () => {
    expect(__videoFramesTest.isLocalCacheUrl("/__framediff-cache/sha256%3Aabc")).toBe(true);
    expect(__videoFramesTest.shouldUseBlobSource("/__framediff-cache/sha256%3Aabc")).toBe(true);
  });

  it("keeps ordinary URLs on the range-capable URL source path", () => {
    expect(__videoFramesTest.isLocalCacheUrl("/clips/source.mp4")).toBe(false);
    expect(__videoFramesTest.shouldUseBlobSource("/clips/source.mp4")).toBe(false);
    expect(__videoFramesTest.shouldUseBlobSource("https://example.com/source.mp4")).toBe(false);
  });

  it("normalizes local cache fetches to one absolute cache key", async () => {
    __videoFramesTest.clearBlobCache();
    const seen: string[] = [];
    const fetcher = async (src: string) => {
      seen.push(src);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        blob: async () => new Blob(["cached"], { type: "video/mp4" }),
      };
    };

    await __videoFramesTest.blobForSource("/__framediff-cache/sha256%3Aabc", fetcher);
    await __videoFramesTest.blobForSource("http://localhost/__framediff-cache/sha256%3Aabc", fetcher);

    expect(seen).toEqual(["http://localhost/__framediff-cache/sha256%3Aabc"]);
    __videoFramesTest.clearBlobCache();
  });

  it("retries transient blob fetch failures for local cache decode", async () => {
    let attempts = 0;
    const blob = await __videoFramesTest.fetchBlobWithRetry(
      "/__framediff-cache/sha256%3Aabc",
      async () => {
        attempts++;
        if (attempts < 3) throw new TypeError("Failed to fetch");
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers(),
          blob: async () => new Blob(["ok"], { type: "video/mp4" }),
        };
      },
      3,
      0,
    );

    expect(attempts).toBe(3);
    expect(blob.size).toBe(2);
  });

  it("caches local cache blobs across frame remounts", async () => {
    __videoFramesTest.clearBlobCache();
    let attempts = 0;
    const fetcher = async () => {
      attempts++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        blob: async () => new Blob(["cached"], { type: "video/mp4" }),
      };
    };

    const first = await __videoFramesTest.blobForSource("/__framediff-cache/sha256%3Aabc", fetcher);
    const second = await __videoFramesTest.blobForSource("/__framediff-cache/sha256%3Aabc", fetcher);

    expect(attempts).toBe(1);
    expect(second).toBe(first);
    __videoFramesTest.clearBlobCache();
  });

  it("evicts failed local cache blob fetches so later attempts can recover", async () => {
    __videoFramesTest.clearBlobCache();
    let attempts = 0;
    const src = "/__framediff-cache/sha256%3Adef";
    await expect(
      __videoFramesTest.blobForSource(src, async () => {
        attempts++;
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow("Failed to fetch");

    const recovered = await __videoFramesTest.blobForSource(src, async () => {
      attempts++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        blob: async () => new Blob(["recovered"], { type: "video/mp4" }),
      };
    });

    expect(attempts).toBe(13);
    expect(recovered.size).toBe(9);
    __videoFramesTest.clearBlobCache();
  });

  it("assembles local cache blobs from deterministic range reads", async () => {
    const data = "abcdefghi";
    const requests: string[] = [];
    const blob = await __videoFramesTest.fetchLocalCacheBlob(
      "http://localhost/__framediff-cache/sha256%3Aranged",
      async (_src, init) => {
        const range = String((init?.headers as Record<string, string> | undefined)?.Range ?? "");
        requests.push(range);
        const match = /^bytes=(\d+)-(\d+)$/.exec(range);
        if (!match) throw new Error("missing range");
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), data.length - 1);
        return {
          ok: true,
          status: 206,
          statusText: "Partial Content",
          headers: new Headers({ "content-range": `bytes ${start}-${end}/${data.length}` }),
          blob: async () => new Blob([data.slice(start, end + 1)], { type: "video/mp4" }),
        };
      },
      4,
    );

    expect(requests).toEqual(["bytes=0-3", "bytes=4-7", "bytes=8-8"]);
    expect(await blob.text()).toBe(data);
  });
});
