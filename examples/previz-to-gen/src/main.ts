// The example app: mount the library's Studio with the comp registry. The Studio brings its
// own styles (preview + render controls); all the video lives in ./config + ./compositions.

import {
  HttpFolderCAS,
  hashBlob,
  createAssetResolver,
  loadManifest,
  type AssetResolver,
  type CompRegistry,
} from "framediff";
import { COMPOSITIONS } from "./config";

let renderToolsPromise: Promise<typeof import("framediff/render")> | undefined;
const loadRenderTools = () => (renderToolsPromise ??= import("framediff/render"));

// The Studio runtime and this dev-hook module both import the registry. Accept updates on this
// path as well, otherwise Vite propagates a composition save through +page.svelte and remounts
  // the UI even though the HTML preview already knows how to replace its registry in place.
let liveCompositions: CompRegistry = COMPOSITIONS;
if (import.meta.hot) {
  import.meta.hot.accept("./config", (module) => {
    if (module) liveCompositions = module.COMPOSITIONS;
  });
}

// ---- dev hook (headless bake — the Studio's ✦ Bake needs a real user gesture) --------------

// asset:// refs resolve through framediff.assets.json + the cache folder, same as the Studio
let resolverP: Promise<AssetResolver> | undefined;
const getResolver = () =>
  (resolverP ??= loadManifest("/__framediff/assets").then((m) =>
    createAssetResolver({ manifest: m, cas: new HttpFolderCAS(), trustLocalCacheSources: true }),
  ));

/** Bake a composition to MP4 and persist it in the configured asset CAS (`assets/` here) — the
 *  derived-output cache, as real files on disk. Returns the content hash. `__bake()` bakes
 *  the previz; ingest the result as `asset://harbor-previz` for the generative comp's ref. */
(window as unknown as Record<string, unknown>).__bake = async (id = "harbor-previz") => {
  const comp = liveCompositions[id];
  if (!comp) throw new Error(`unknown comp "${id}"`);
  const { exportVideo } = await loadRenderTools();
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
  await cas.put(hash, blob);
  console.log(`[bake] ${id} → ${hash} · persisted: ${await cas.has(hash)}`);
  return hash;
};
