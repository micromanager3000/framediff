// Deterministic source-video frames for the render, via WebCodecs (MediaBunny handles
// demux + decode). getCanvas(t) returns the exact frame displayed at time t — the last frame
// whose start timestamp <= t — so frame selection is exact and reproducible, with no
// HTMLVideoElement seek heuristics and no mid-update playback buffer.
//
// Robustness: decoder init can stall indefinitely under pressure (observed mid-export while a
// fresh attempt on the same URL succeeds in milliseconds). A memoized never-settling promise
// would poison every later call, so init races a deadline; on timeout the cache entry is
// evicted and retried before giving up. Local FrameDiff cache URLs use a blob-backed source assembled
// from deterministic range reads, so export doesn't depend on flaky full-response media fetches.
// Preview callers may use bounded fallbacks; export/effect capture callers should fail rather
// than bake a guessed frame.

import { Input, BlobSource, UrlSource, ALL_FORMATS, CanvasSink } from "mediabunny";
import { bgDelay } from "./bgTimer";

const INIT_DEADLINE_MS = 15000;
const FETCH_RETRIES = 12;
const FETCH_RETRY_DELAY_MS = 250;
const LOCAL_CACHE_RANGE_CHUNK_BYTES = 4 * 1024 * 1024;
const STALLED = Symbol("stalled");
const blobCache = new Map<string, Promise<Blob>>();

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | typeof STALLED> {
  return Promise.race([p, bgDelay(ms).then((): typeof STALLED => STALLED)]);
}

const delay = bgDelay;

function isLocalCacheUrl(src: string): boolean {
  try {
    const url = new URL(src, typeof location !== "undefined" ? location.href : "http://localhost");
    return url.pathname.startsWith("/__framediff-cache/");
  } catch {
    return src.startsWith("/__framediff-cache/");
  }
}

function absoluteLocalCacheUrl(src: string): string {
  if (!isLocalCacheUrl(src)) return src;
  try {
    return new URL(src, typeof location !== "undefined" ? location.href : "http://localhost").href;
  } catch {
    return src;
  }
}

function shouldUseBlobSource(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:") || isLocalCacheUrl(src);
}

export function clearVideoFrameBlobCache(): void {
  blobCache.clear();
}

export class VideoFrameSource {
  private sinks = new Map<string, Promise<CanvasSink | null>>();
  private errors = new Map<string, unknown>();

  static clearBlobCache(): void {
    clearVideoFrameBlobCache();
  }

  lastError(src: string): unknown {
    return this.errors.get(src);
  }

  private load(src: string): Promise<CanvasSink | null> {
    let p = this.sinks.get(src);
    if (!p) {
      p = (async () => {
        try {
          const source = shouldUseBlobSource(src)
            ? await blobSource(src)
            : new UrlSource(src, { parallelism: 1, getRetryDelay: () => null });
          const input = new Input({ formats: ALL_FORMATS, source });
          const track = await input.getPrimaryVideoTrack();
          if (!track) throw new Error("no primary video track");
          this.errors.delete(src);
          return new CanvasSink(track);
        } catch (e) {
          this.errors.set(src, e);
          return null;
        }
      })();
      this.sinks.set(src, p);
    }
    return p;
  }

  private async loadFresh(src: string): Promise<CanvasSink | null> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const sink = await withDeadline(this.load(src), INIT_DEADLINE_MS);
      if (sink === STALLED) {
        this.sinks.delete(src);
        if (attempt === 3) this.errors.set(src, new Error(`decoder init stalled three times (> ${INIT_DEADLINE_MS}ms)`));
      } else if (sink) {
        return sink;
      } else {
        this.sinks.delete(src); // transient init/fetch failures must not poison the source
      }
      if (attempt < 3) await delay(250);
      else if (!this.errors.has(src)) this.errors.set(src, new Error("decoder init failed after retries"));
    }
    return null;
  }

  /** The exact frame at time `t` (seconds) as an HTMLCanvas (lossless), or null if undecodable.
   *  Useful as a texture source for the effect tier (no JPEG round-trip). */
  async frameCanvas(src: string, t: number): Promise<HTMLCanvasElement | null> {
    const sink = await this.loadFresh(src);
    if (!sink) return null;
    const wrapped = await withDeadline(sink.getCanvas(Math.max(0, t)), INIT_DEADLINE_MS);
    if (wrapped === STALLED) {
      // a stalled decode poisons the sink too — drop it so the next call rebuilds
      this.sinks.delete(src);
      this.errors.set(src, new Error(`decode stalled at ${t.toFixed(3)}s`));
      return null;
    }
    if (!wrapped) return null;
    // copy into an HTMLCanvas (the sink may hand back an OffscreenCanvas)
    const c = document.createElement("canvas");
    c.width = wrapped.canvas.width;
    c.height = wrapped.canvas.height;
    const g = c.getContext("2d");
    if (!g) return null;
    g.drawImage(wrapped.canvas as CanvasImageSource, 0, 0);
    return c;
  }

  /** PNG data URL of the exact frame at time `t` (seconds), or null if it can't be decoded.
   *  Lossless on purpose: this frame is baked into the export, and JPEG at any quality strips
   *  film grain and leaves DCT blocks that the final encode then amplifies. */
  async frameDataURL(src: string, t: number): Promise<string | null> {
    const c = await this.frameCanvas(src, t);
    return c ? c.toDataURL("image/png") : null;
  }
}

type FetchLike = (
  src: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "statusText" | "blob" | "headers">>;

async function fetchResponseWithRetry(
  src: string,
  fetcher: FetchLike = fetch,
  init?: RequestInit,
  attempts = FETCH_RETRIES,
  retryDelayMs = FETCH_RETRY_DELAY_MS,
): Promise<Pick<Response, "ok" | "status" | "statusText" | "blob" | "headers">> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(src, init);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      return response;
    } catch (e) {
      lastError = e;
      if (attempt < attempts && retryDelayMs > 0) await delay(retryDelayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "fetch failed"));
}

async function fetchBlobWithRetry(
  src: string,
  fetcher: FetchLike = fetch,
  attempts = FETCH_RETRIES,
  retryDelayMs = FETCH_RETRY_DELAY_MS,
): Promise<Blob> {
  const response = await fetchResponseWithRetry(src, fetcher, undefined, attempts, retryDelayMs);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("empty response body");
  return blob;
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value ?? "");
  if (!match || match[3] === "*") return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(total) ? { start, end, total } : null;
}

async function fetchLocalCacheBlob(
  src: string,
  fetcher: FetchLike = fetch,
  chunkBytes = LOCAL_CACHE_RANGE_CHUNK_BYTES,
): Promise<Blob> {
  const firstEnd = Math.max(0, chunkBytes - 1);
  const first = await fetchResponseWithRetry(src, fetcher, { headers: { Range: `bytes=0-${firstEnd}` } });
  if (first.status !== 206) {
    const blob = await first.blob();
    if (blob.size === 0) throw new Error("empty response body");
    return blob;
  }

  const firstRange = parseContentRange(first.headers.get("content-range"));
  if (!firstRange) throw new Error("partial response missing content-range");
  const firstBlob = await first.blob();
  if (firstBlob.size === 0) throw new Error("empty response body");
  if (firstRange.total <= firstRange.end + 1) return firstBlob;

  const parts: BlobPart[] = [firstBlob];
  let nextStart = firstRange.end + 1;
  while (nextStart < firstRange.total) {
    const nextEnd = Math.min(firstRange.total - 1, nextStart + chunkBytes - 1);
    const response = await fetchResponseWithRetry(src, fetcher, { headers: { Range: `bytes=${nextStart}-${nextEnd}` } });
    if (response.status !== 206) throw new Error(`range request returned HTTP ${response.status}`);
    const range = parseContentRange(response.headers.get("content-range"));
    if (!range || range.start !== nextStart) throw new Error("range response did not match requested offset");
    const blob = await response.blob();
    if (blob.size === 0) throw new Error("empty response body");
    parts.push(blob);
    nextStart = range.end + 1;
  }
  return new Blob(parts, { type: firstBlob.type || "application/octet-stream" });
}

function shouldCacheBlob(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:") || isLocalCacheUrl(src);
}

async function blobForSource(src: string, fetcher: FetchLike = fetch): Promise<Blob> {
  const fetchSrc = absoluteLocalCacheUrl(src);
  if (!shouldCacheBlob(src)) return fetchBlobWithRetry(fetchSrc, fetcher);
  let pending = blobCache.get(fetchSrc);
  if (!pending) {
    pending = (isLocalCacheUrl(src) ? fetchLocalCacheBlob(fetchSrc, fetcher) : fetchBlobWithRetry(fetchSrc, fetcher)).catch((err) => {
      blobCache.delete(fetchSrc);
      throw err;
    });
    blobCache.set(fetchSrc, pending);
  }
  return pending;
}

async function blobSource(src: string): Promise<BlobSource> {
  const blob = await blobForSource(src);
  return new BlobSource(blob);
}

export const __videoFramesTest = {
  absoluteLocalCacheUrl,
  blobForSource,
  clearBlobCache: clearVideoFrameBlobCache,
  fetchLocalCacheBlob,
  fetchBlobWithRetry,
  isLocalCacheUrl,
  parseContentRange,
  shouldUseBlobSource,
};
