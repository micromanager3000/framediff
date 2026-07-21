// Mirror public/raw/*.mp4 into the configured FrameDiff asset store under stable `proxy-<name>` ids.
// Idempotent: re-cut a proxy with make-proxies.sh, run this, and the same asset id points at
// the new bytes — no source edits needed. (The Studio's ingest endpoint mints fresh uuids; the
// proxies want STABLE ids so heroEdl.ts can reference them forever.)
//
//   node scripts/sync-proxies.mjs

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const rawDir = join(root, "public/raw");
const configPath = join(root, "framediff.config.json");
const projectConfig = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : null;
const configuredAssetDir =
  projectConfig?.assets?.mode === "git-lfs"
    ? "assets"
    : projectConfig?.assets?.mode === "local"
      ? projectConfig.assets.path
      : null;
const cacheDir = process.env.FRAMEDIFF_CACHE_DIR
  ? resolve(root, process.env.FRAMEDIFF_CACHE_DIR)
  : configuredAssetDir
    ? resolve(root, configuredAssetDir)
    : join(root, "framediff-cache");
const manifestPath = join(root, "framediff.assets.json");

const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { version: 1, assets: {} };
mkdirSync(cacheDir, { recursive: true });

const parentAssetId = {
  open: "c564314e-6dd9-417f-bc06-6a8110964a80",
  phone: "3e449888-0514-4079-b9c4-b3e2db9e5036",
  grid: "cf3cdc78-3fe4-464a-bcc9-e05c2e24cdad",
  news: "f753f5f7-6248-421f-a1c9-521038083aaf",
  uizoom: "e24bd202-2f43-4068-a8a6-e01c6a211afa",
  june3d: "b1a7edc8-b272-446d-b008-8f357d3dae74",
  "split-l": "a7593343-316b-4105-a02e-fe56da2590c7",
  "split-r": "2d1c65c2-e291-4a54-9ba1-baebba370975",
  cam4: "1f7ea0b8-1d9e-4973-98fa-526fde09e1a2",
  cam6: "1f7ea0b8-1d9e-4973-98fa-526fde09e1a2",
  "keynote-a": "a133b071-aaab-4e52-a27e-d17b68001c94",
  "hf-talk": "3c5d912b-6657-4fd9-8480-cf4e8602c768",
  magnific: "1ccc7e58-8391-49ee-b6e5-b02c68e1b337",
  greenwide: "666ee08a-03b2-4249-a48f-646e87559269",
  desk: "24bd8424-47b6-470e-98ac-0920cb2e3421",
  smartest: "d56f429f-3ab7-452f-bc9a-d0c2b51b5a77",
  blazer: "5588595d-f8e1-40f0-9f54-611b50d4ff82",
  tripod: "3b0601e4-5906-49f5-9d39-4b98533c056f",
  "keynote-b": "50ff4736-f5a8-4667-88f9-ae99551eff0e",
  flare: "68deb1f4-c321-4c2d-a14c-362cf75343d1",
};

const hashFromCacheName = (name) => {
  const legacy = /^([a-z][a-z0-9_-]*):([a-zA-Z0-9]{16,})$/.exec(name);
  if (legacy) return `${legacy[1]}:${legacy[2]}`;
  const readable = /--([a-z][a-z0-9_-]*)-([a-zA-Z0-9]{16,})(?:\.[a-zA-Z0-9]{1,12})?$/.exec(name);
  return readable ? `${readable[1]}:${readable[2]}` : null;
};
const cachedHashes = new Set(readdirSync(cacheDir).map(hashFromCacheName).filter(Boolean));
const readableCacheName = (name, hash) => {
  const ext = name.endsWith(".mp4") ? ".mp4" : "";
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem}--${hash.replace(":", "-")}${ext}`;
};

let changed = 0;
for (const file of readdirSync(rawDir).sort()) {
  if (!file.endsWith(".mp4")) continue;
  const stem = basename(file, ".mp4");
  const id = `proxy-${stem}`;
  const derivedFrom = parentAssetId[stem];
  if (!derivedFrom) throw new Error(`Add the source asset id for ${file} to parentAssetId before syncing it.`);
  const buf = readFileSync(join(rawDir, file));
  const hash = "sha256:" + createHash("sha256").update(buf).digest("hex");
  const casFile = join(cacheDir, readableCacheName(`proxy-${file}`, hash));
  if (!cachedHashes.has(hash)) {
    writeFileSync(casFile, buf);
    cachedHashes.add(hash);
  }
  const prev = manifest.assets[id];
  const next = {
    ...prev,
    name: `proxy-${file}`,
    contentHash: hash,
    mime: "video/mp4",
    bytes: buf.length,
    sources: [`/__framediff-cache/${encodeURIComponent(hash)}`],
    derivedFrom,
  };
  if (JSON.stringify(prev) === JSON.stringify(next)) continue;
  manifest.assets[id] = next;
  changed++;
  console.log(`${prev ? "updated" : "added"}  ${id}  ${hash.slice(0, 23)}…  ${buf.length} bytes`);
}
if (changed) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(changed ? `manifest updated (${changed} entries)` : "manifest already in sync");
