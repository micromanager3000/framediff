import {
  exportVideo,
  exportVideoToSink,
  HttpFolderCAS,
  hashBlob,
  createAssetResolver,
  loadManifest,
  type AssetResolver,
} from "framediff";
import { COMPOSITIONS } from "./config";
import { preloadLuts } from "./effects/luts";

let liveCompositions = COMPOSITIONS;
let composition = liveCompositions["studio-playground"];

// This module is imported for its headless render hooks as well as config being imported by
// studio-runtime. Accept that second path so a comp save updates only the HTML preview instead
// of propagating into +page.svelte and remounting the Svelte Studio shell.
if (import.meta.hot) {
  import.meta.hot.accept("./config", (module) => {
    if (!module) return;
    liveCompositions = module.COMPOSITIONS;
    composition = liveCompositions["studio-playground"];
  });
}

// the fitted grade LUTs must be resident before any render/export bakes a frame
void preloadLuts();

// ---- dev hooks (driven headlessly by the compare loop; harmless in normal use) ----

// asset:// refs resolve through framediff.assets.json + the cache folder, same as the Studio
let resolverP: Promise<AssetResolver> | undefined;
const getResolver = () =>
  (resolverP ??= loadManifest("/__framediff/assets").then((m) =>
    createAssetResolver({ manifest: m, cas: new HttpFolderCAS(), trustLocalCacheSources: true }),
  ));

const writeOutChunk = async (name: string, data: Uint8Array, position: number) => {
  const res = await fetch(`/__out-chunk/${encodeURIComponent(name)}?position=${position}`, {
    method: "PUT",
    body: new Uint8Array(data),
  });
  if (!res.ok) throw new Error(`could not write ${name} chunk at ${position}: ${await res.text()}`);
};

/** Render [start, end) of the current composition and persist it to out/<name> via the vite
 *  middleware. The default treats the output as a MASTER: WebCodecs here is VideoToolbox
 *  hardware H.264, which has no psychovisual rate control — at delivery bitrates it planes
 *  film grain and face texture into plastic (measured: pre-encode probes beat the reference's
 *  detail; the 24 Mbps encode fell below it). 40 Mbps keeps the texture; for delivery-size
 *  files transcode the master with x264, which protects grain at ~9 Mbps:
 *    ffmpeg -i out/master.mp4 -c:v libx264 -preset slow -crf 18 -tune grain -c:a copy out/delivery.mp4 */
(window as unknown as Record<string, unknown>).__renderRange = async (
  start = 0,
  end = composition.durationInFrames,
  name = "render.mp4",
  bitrate = 40_000_000,
) => {
  await fetch(`/__out/${encodeURIComponent(name)}`, { method: "DELETE" });
  const result = await exportVideoToSink(composition, {
    width: composition.width,
    height: composition.height,
    codec: "avc1.640028",
    muxerCodec: "avc",
    bitrate,
    startFrame: start,
    endFrame: end,
    resolver: await getResolver(),
    onProgress: (p) => {
      if (p.phase !== "render") return;
      if (p.framesRendered % 48 === 0 || p.framesRendered === p.totalFrames)
        console.log(`[render] ${p.framesRendered}/${p.totalFrames}`);
    },
    sink: {
      write: (data, position) => writeOutChunk(name, data, position),
      abort: () => fetch(`/__out/${encodeURIComponent(name)}`, { method: "DELETE" }).then(() => undefined),
    },
  });
  console.log(`[render] saved ${name} (${result.bytesWritten} bytes, streamed ${result.fastStart === "fragmented" ? "fragmented" : "normal"} MP4)`);
  return name;
};

/** Bake a composition to MP4 and persist it in the configured asset CAS (`assets/` here) — the
 *  derived-output cache, as real files on disk. Returns the content hash. */
(window as unknown as Record<string, unknown>).__bake = async (id = "lower-third") => {
  const comp = liveCompositions[id];
  if (!comp) throw new Error(`unknown comp "${id}"`);
  const cas = new HttpFolderCAS();
  const buf = await exportVideo(comp, {
    width: comp.width,
    height: comp.height,
    codec: "avc1.640028",
    muxerCodec: "avc",
    bitrate: 6_000_000,
    resolver: await getResolver(),
  });
  const blob = new Blob([buf], { type: "video/mp4" });
  const hash = await hashBlob(blob);
  await cas.put(hash, blob, `${comp.id}.bake.mp4`);
  console.log(`[bake] ${id} → ${hash} · persisted: ${await cas.has(hash)}`);
  return hash;
};

/** Bake specific frames through the REAL export path and persist PNGs to out/probe/ —
 *  the compare loop diffs them against the reference. __probe("hero-raw", [0, 60, 120]) */
(window as unknown as Record<string, unknown>).__probe = async (id = "hero-raw", frames: number[] = [0]) => {
  const { captureCompositeFrame } = await import("framediff");
  const comp = liveCompositions[id];
  if (!comp) throw new Error(`unknown comp "${id}"`);
  for (const f of frames) {
    const canvas = await captureCompositeFrame(comp, f, { width: comp.width, height: comp.height, resolver: await getResolver() });
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    await fetch(`/__out/${encodeURIComponent(`probe-${id}-f${f}.png`)}`, { method: "PUT", body: blob });
    console.log(`[probe] ${id} f${f} saved`);
  }
  return frames.length;
};
