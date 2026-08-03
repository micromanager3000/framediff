// Studio dev bridge: a vite plugin exposing the endpoints documented in
// src/studio/types.ts ("Dev bridge" block). Dev only — everything is rooted at
// the vite app root and there is no auth; never mount this in production.
//
// Vite is deliberately not imported (it is not a dependency of this package):
// the plugin is a plain object structurally compatible with vite's Plugin.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GenInputProvenance, GenPresentationSnapshot, GenProvider, GenRecipeSnapshot, GenRefKind } from "./src/generative";

type NextFn = (err?: unknown) => void;
type DevServer = {
  config: { root: string };
  middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: NextFn) => void): void };
  watcher?: { unwatch(path: string): unknown };
};
export interface FrameDiffDevPlugin {
  name: string;
  config(): {
    optimizeDeps: { include: string[]; exclude: string[] };
    server: { fs: { allow: string[] } };
    build: {
      chunkSizeWarningLimit: number;
      rollupOptions: {
        output: {
          onlyExplicitManualChunks: boolean;
          manualChunks(id: string): string | undefined;
        };
      };
    };
  };
  configureServer(server: DevServer): void;
}

export interface FrameDiffDevOptions {
  /**
   * Folder used for imported media, baked artifacts, and generation results.
   * Relative paths are resolved from Vite's project root. `~` and absolute paths
   * are also supported. This override takes precedence over `framediff.config.json`.
   * Without an override, the project config selects local or Git LFS storage; legacy
   * projects default to the visible `framediff-cache` folder.
   */
  cacheDir?: string;
  /**
   * Equivalent project directory whose ignored cache/public media may be used as a read-only
   * fallback. Linked Git worktrees discover the primary checkout automatically.
   */
  sharedProjectDir?: string;
}

export type FrameDiffAssetConfig =
  | { mode: "local"; path: string }
  | { mode: "git-lfs" };

/** Declarative project metadata. JSON keeps discovery safe for local launchers. */
export interface FrameDiffProjectConfig {
  assets?: FrameDiffAssetConfig;
}

/** This package's root on disk. Module workers (render/encodeWorker.ts) resolve
 *  relative to the package source, which SvelteKit's fs allow-list does not cover
 *  by default; without allowing it the worker request 403s and export never starts. */
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Extensions the src endpoint may read/write. */
const SRC_EXTS = new Set([".html", ".js", ".mjs", ".ts", ".tsx", ".md", ".css", ".json"]);

/** Media the asset-ingest endpoints accept, with their mime types. */
const MEDIA_MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".cube": "text/plain", ".gltf": "model/gltf+json", ".glb": "model/gltf-binary",
};

// Same sanitization as the original inline example plugin — keep byte-compatible.
const safe = (s: string) => decodeURIComponent(s).replace(/[^a-zA-Z0-9:_.-]/g, "_");

const HASH_KEY = /^([a-z][a-z0-9_-]*):([a-zA-Z0-9]{16,})$/;
const READABLE_HASH_SUFFIX = /--([a-z][a-z0-9_-]*)-([a-zA-Z0-9]{16,})(?:\.[a-zA-Z0-9]{1,12})?$/;

function extensionForMime(mime?: string): string {
  if (!mime) return "";
  return Object.entries(MEDIA_MIME).find(([, value]) => value === mime)?.[0] ?? "";
}

/** A readable physical filename whose full hash still makes it a unique CAS object. */
function readableCacheName(name: string, hash: string, mime?: string): string {
  const hashMatch = HASH_KEY.exec(hash);
  if (!hashMatch) return safe(hash);
  const original = path.basename(name).normalize("NFKC");
  const originalExt = path.extname(original);
  const ext = /^\.[a-zA-Z0-9]{1,12}$/.test(originalExt) ? originalExt.toLowerCase() : extensionForMime(mime);
  const rawStem = originalExt ? original.slice(0, -originalExt.length) : original;
  const stem = rawStem
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 96) || "artifact";
  return `${stem}--${hashMatch[1]}-${hashMatch[2]}${ext}`;
}

/** Recover the logical CAS key from either a legacy hash-only or readable filename. */
function hashFromCacheName(name: string): string | null {
  const withoutMeta = name.endsWith(".meta.json") ? name.slice(0, -".meta.json".length) : name;
  if (HASH_KEY.test(withoutMeta)) return withoutMeta;
  const match = READABLE_HASH_SUFFIX.exec(withoutMeta);
  return match ? `${match[1]}:${match[2]}` : null;
}

const DEFAULT_CACHE_DIR = "framediff-cache";
const PROJECT_CONFIG_FILE = "framediff.config.json";
const GIT_LFS_ASSETS_DIR = "assets";
const GIT_LFS_ATTRIBUTES = "assets/** filter=lfs diff=lfs merge=lfs -text";

function readProjectConfig(root: string): FrameDiffProjectConfig | null {
  const file = path.join(root, PROJECT_CONFIG_FILE);
  if (!fs.existsSync(file)) return null;

  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${PROJECT_CONFIG_FILE} is not valid JSON: ${String((error as Error).message)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${PROJECT_CONFIG_FILE} must contain a JSON object.`);
  }

  const assets = (value as { assets?: unknown }).assets;
  if (assets == null) return {};
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) {
    throw new Error(`${PROJECT_CONFIG_FILE} assets must be an object with mode "local" or "git-lfs".`);
  }
  const candidate = assets as { mode?: unknown; path?: unknown };
  if (candidate.mode === "git-lfs") return { assets: { mode: "git-lfs" } };
  if (candidate.mode === "local") {
    if (typeof candidate.path !== "string" || !candidate.path.trim()) {
      throw new Error(`${PROJECT_CONFIG_FILE} local assets require a non-empty assets.path.`);
    }
    return { assets: { mode: "local", path: candidate.path.trim() } };
  }
  throw new Error(`${PROJECT_CONFIG_FILE} assets.mode must be "local" or "git-lfs".`);
}

function resolveLocalPath(root: string, value: string): string {
  const expanded = value === "~"
    ? os.homedir()
    : value.startsWith("~/") || value.startsWith("~\\")
      ? path.join(os.homedir(), value.slice(2))
      : value;
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(root, expanded);
}

type ResolvedAssetStorage = {
  mode: "local" | "git-lfs";
  directory: string;
  explicit: boolean;
};

function resolveAssetStorage(root: string, option?: string): ResolvedAssetStorage {
  const override = option?.trim() || process.env.FRAMEDIFF_CACHE_DIR?.trim();
  if (override) return { mode: "local", directory: resolveLocalPath(root, override), explicit: true };

  const configured = readProjectConfig(root)?.assets;
  if (configured?.mode === "git-lfs") {
    return { mode: "git-lfs", directory: path.join(root, GIT_LFS_ASSETS_DIR), explicit: true };
  }
  if (configured?.mode === "local") {
    return { mode: "local", directory: resolveLocalPath(root, configured.path), explicit: true };
  }
  return { mode: "local", directory: path.join(root, DEFAULT_CACHE_DIR), explicit: false };
}

function ensureGitLfsAssetStorage(root: string): void {
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    throw new Error(`${PROJECT_CONFIG_FILE} selects git-lfs, but ${root} is not inside a Git repository.`);
  }
  try {
    execFileSync("git", ["lfs", "version"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["lfs", "install", "--local"], { cwd: root, stdio: "ignore" });
  } catch {
    throw new Error(`${PROJECT_CONFIG_FILE} selects git-lfs, but Git LFS is not installed or could not be initialized.`);
  }

  const attributesFile = path.join(root, ".gitattributes");
  const existing = fs.existsSync(attributesFile) ? fs.readFileSync(attributesFile, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  if (!lines.includes(GIT_LFS_ATTRIBUTES)) {
    const prefix = existing.length && !existing.endsWith("\n") ? `${existing}\n` : existing;
    fs.writeFileSync(attributesFile, `${prefix}${GIT_LFS_ATTRIBUTES}\n`, "utf8");
  }
  fs.mkdirSync(path.join(root, GIT_LFS_ASSETS_DIR), { recursive: true });
}

/** Map a Vite project inside a linked worktree to the same project in the primary checkout. */
function linkedPrimaryProject(root: string): string | null {
  try {
    const worktreeRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const commonDirRaw = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const commonDir = path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(worktreeRoot, commonDirRaw);
    const primaryRoot = path.dirname(commonDir);
    if (path.resolve(primaryRoot) === path.resolve(worktreeRoot)) return null;
    const projectRelative = path.relative(worktreeRoot, root);
    if (projectRelative === ".." || projectRelative.startsWith(`..${path.sep}`) || path.isAbsolute(projectRelative)) return null;
    const candidate = path.resolve(primaryRoot, projectRelative);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function safeChild(root: string, pathname: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^[/\\]+/, "");
  } catch {
    return null;
  }
  const candidate = path.resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

function sendFile(req: IncomingMessage, res: ServerResponse, file: string) {
  const st = fs.statSync(file);
  if (!st.isFile()) {
    res.statusCode = 404;
    return res.end();
  }

  const total = st.size;
  const range = req.headers.range;
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", MEDIA_MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");

  let start = 0;
  let end = Math.max(0, total - 1);
  let partial = false;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.statusCode = 416;
      res.setHeader("content-range", `bytes */${total}`);
      return res.end();
    }
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Number(m[2]) : total - 1;
    } else if (m[2]) {
      const suffix = Number(m[2]);
      start = Math.max(0, total - suffix);
      end = total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) {
      res.statusCode = 416;
      res.setHeader("content-range", `bytes */${total}`);
      return res.end();
    }
    end = Math.min(end, total - 1);
    partial = true;
  }

  const length = total === 0 ? 0 : end - start + 1;
  res.statusCode = partial ? 206 : 200;
  res.setHeader("content-length", String(length));
  if (partial) res.setHeader("content-range", `bytes ${start}-${end}/${total}`);
  if (req.method === "HEAD" || total === 0) return res.end();
  fs.createReadStream(file, { start, end }).pipe(res);
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const git = (root: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile("git", args, { cwd: root }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout),
    );
  });

const revealFileOnDisk = (file: string) =>
  new Promise<void>((resolve, reject) => {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    const args = process.platform === "darwin"
      ? ["-R", file]
      : process.platform === "win32"
        ? ["/select,", file]
        : [path.dirname(file)];
    execFile(command, args, (err) => err ? reject(err) : resolve());
  });

/** Resolve REL against root; null unless it stays inside root, avoids
 *  node_modules, and has an allowlisted extension. */
function resolveSrc(root: string, rel: string | null): string | null {
  if (!rel) return null;
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return null;
  if (abs.split(path.sep).includes("node_modules")) return null;
  if (!SRC_EXTS.has(path.extname(abs))) return null;
  return abs;
}

function sourceHash(text: string): string {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

type SourceEditFileRequest = { file: string; expectedHash: string | null; text: string | null };
type SourceRevision = { file: string; text: string | null; hash: string | null };

function sourceRevision(file: string, abs: string): SourceRevision {
  if (!fs.existsSync(abs)) return { file, text: null, hash: null };
  const text = fs.readFileSync(abs, "utf8");
  return { file, text, hash: sourceHash(text) };
}

/** Commit all source files or restore all originals. Temp/backup files stay beside each target so
 * every rename is atomic on the target filesystem. */
function writeSourceTransaction(
  entries: { request: SourceEditFileRequest; abs: string; before: SourceRevision }[],
  transactionId: string,
): void {
  const prepared: { abs: string; temp: string | null; backup: string | null }[] = [];
  try {
    for (const { request, abs, before } of entries) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const temp = request.text == null ? null : `${abs}.framediff-${transactionId}.tmp`;
      const backup = before.text == null ? null : `${abs}.framediff-${transactionId}.bak`;
      if (temp && request.text != null) fs.writeFileSync(temp, request.text, "utf8");
      prepared.push({ abs, temp, backup });
    }
    for (const entry of prepared) if (entry.backup) fs.renameSync(entry.abs, entry.backup);
    for (const entry of prepared) if (entry.temp) fs.renameSync(entry.temp, entry.abs);
    for (const entry of prepared) {
      try { if (entry.backup && fs.existsSync(entry.backup)) fs.unlinkSync(entry.backup); } catch { /* committed; stale backup is safe */ }
    }
  } catch (error) {
    for (const entry of [...prepared].reverse()) {
      try {
        if (fs.existsSync(entry.abs)) fs.unlinkSync(entry.abs);
        if (entry.backup && fs.existsSync(entry.backup)) fs.renameSync(entry.backup, entry.abs);
        if (entry.temp && fs.existsSync(entry.temp)) fs.unlinkSync(entry.temp);
      } catch {
        // Preserve the original transaction error. A later source conflict will expose any
        // exceptional filesystem-level rollback failure instead of silently overwriting it.
      }
    }
    throw error;
  } finally {
    for (const entry of prepared) {
      try { if (entry.temp && fs.existsSync(entry.temp)) fs.unlinkSync(entry.temp); } catch { /* best effort */ }
      try { if (entry.backup && fs.existsSync(entry.backup)) fs.unlinkSync(entry.backup); } catch { /* best effort */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Generative comps: provider secrets + the fal proxy (/__framediff/secrets, /__framediff/gen/*)
// ---------------------------------------------------------------------------
//
// Keys never reach the browser: PUT stores them in .framediff/secrets.json (a gitignored dir,
// resolved at the nearest git root so every example shares one file), GET returns only
// {set, last4, source}. Generation calls run server-side against queue.fal.run; finished
// takes are downloaded into the CAS and recorded in framediff.assets.json with a `generator`
// provenance block. Every attempt — including failures — persists in the repo-tracked
// <root>/framediff.generations.json ledger. The former gitignored .framediff/gen-jobs.json
// is read once as a migration source so existing paid request history is not lost.

const KNOWN_PROVIDERS = ["fal", "midjourney", "luma", "byteplus", "replicate", "elevenlabs"] as const;
const PROVIDER_ENV: Record<string, string> = {
  fal: "FAL_KEY",
  midjourney: "MIDJOURNEY_API_KEY",
  luma: "LUMAAI_API_KEY",
  byteplus: "ARK_API_KEY",
  replicate: "REPLICATE_API_TOKEN",
  elevenlabs: "ELEVENLABS_API_KEY",
};

/** Nearest .framediff/secrets.json walking up from root; settle at the git top-level. */
function secretsFile(root: string): string {
  let dir = root;
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, ".framediff", "secrets.json");
    if (fs.existsSync(p)) return p;
    if (fs.existsSync(path.join(dir, ".git"))) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(root, ".framediff", "secrets.json");
}

type SecretsFile = Record<string, { key?: string }>;
function readSecretsRaw(root: string): SecretsFile {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(root), "utf8")) as SecretsFile;
  } catch {
    return {};
  }
}
/** Key for a provider: secrets file first, then the conventional env var. */
function providerKey(root: string, provider: string): { key: string; source: "file" | "env" } | null {
  const fromFile = readSecretsRaw(root)[provider]?.key;
  if (fromFile) return { key: fromFile, source: "file" };
  const env = process.env[PROVIDER_ENV[provider] ?? ""];
  if (env) return { key: env, source: "env" };
  return null;
}

interface GenJobRecord {
  id: string; // stable local attempt id; legacy records used the provider request id
  /** Missing on legacy records, which were all submitted through fal. */
  provider?: GenProvider;
  providerJobId?: string;
  gen: string;
  endpoint: string;
  recipeHash: string;
  statusUrl?: string;
  responseUrl?: string;
  status: "queued" | "running" | "done" | "failed";
  error?: string;
  take?: number;
  assetId?: string;
  seed?: number;
  outputKind?: "video" | "image" | "audio";
  /** Provider-specific immutable take provenance (for example Voice Design candidate ids). */
  takeMetadata?: Record<string, unknown>;
  at: string;
  doneAt?: string;
  recipe: GenRecipeSnapshot;
  inputs: GenInputProvenance[];
  presentation?: GenPresentationSnapshot;
}
function jobsFile(root: string): string {
  return path.join(root, "framediff.generations.json");
}
function legacyJobsFile(root: string): string {
  return path.join(root, ".framediff", "gen-jobs.json");
}
function readJobsFrom(file: string): GenJobRecord[] | null {
  try {
    const document = JSON.parse(fs.readFileSync(file, "utf8")) as { jobs?: GenJobRecord[] };
    return Array.isArray(document.jobs) ? document.jobs : null;
  } catch {
    return null;
  }
}
function readJobs(root: string): GenJobRecord[] {
  return readJobsFrom(jobsFile(root)) ?? readJobsFrom(legacyJobsFile(root)) ?? [];
}
function normalizeJobTakes(jobs: GenJobRecord[]): boolean {
  const highest = new Map<string, number>();
  for (const job of jobs) {
    if (job.take != null) highest.set(job.gen, Math.max(highest.get(job.gen) ?? 0, job.take));
  }
  let changed = false;
  for (const job of jobs) {
    if (job.take == null) {
      const take = (highest.get(job.gen) ?? 0) + 1;
      highest.set(job.gen, take);
      job.take = take;
      changed = true;
    }
    if (!job.providerJobId && job.statusUrl) {
      job.providerJobId = job.id;
      changed = true;
    }
  }
  return changed;
}
function nextJobTake(
  jobs: readonly GenJobRecord[],
  gen: string,
  manifest?: { assets: Record<string, unknown> },
): number {
  const ledgerTakes = jobs.filter((job) => job.gen === gen).map((job) => job.take ?? 0);
  const manifestTakes = Object.values(manifest?.assets ?? {}).map((entry) => {
    const generator = (entry as { generator?: { gen?: string; take?: number } }).generator;
    return generator?.gen === gen ? generator.take ?? 0 : 0;
  });
  return Math.max(0, ...ledgerTakes, ...manifestTakes) + 1;
}
function writeJobs(root: string, jobs: GenJobRecord[]) {
  fs.writeFileSync(jobsFile(root), JSON.stringify({ version: 1, jobs }, null, 2) + "\n");
}
function saveJob(root: string, job: GenJobRecord): void {
  const jobs = readJobs(root);
  const index = jobs.findIndex((candidate) => candidate.id === job.id);
  if (index < 0) jobs.push(job);
  else jobs[index] = job;
  normalizeJobTakes(jobs);
  writeJobs(root, jobs);
}

/** Upload bytes to fal storage; returns a URL the model can read. */
async function falUpload(key: string, buf: Buffer, mime: string, name: string): Promise<string> {
  const init = await fetch("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ file_name: name, content_type: mime }),
  });
  if (!init.ok) throw new Error(`storage initiate ${init.status}: ${(await init.text()).slice(0, 200)}`);
  const j = (await init.json()) as { upload_url?: string; file_url?: string; access_url?: string };
  if (!j.upload_url) throw new Error("storage initiate: no upload_url");
  const put = await fetch(j.upload_url, { method: "PUT", headers: { "content-type": mime }, body: new Uint8Array(buf) });
  if (!put.ok) throw new Error(`storage upload ${put.status}`);
  const url = j.file_url ?? j.access_url;
  if (!url) throw new Error("storage initiate: no file_url");
  return url;
}

const DATA_URI_MAX = 8 * 1024 * 1024; // fallback when storage upload fails; ~10.7MB base64
const BYTEPLUS_ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const ELEVENLABS_BASE = "https://api.elevenlabs.io";

/** Jobs mid-finalization — two overlapping /gen/jobs polls must not ingest a take twice. */
const finalizing = new Set<string>();

function framediffManualChunk(id: string): string | undefined {
  const normalized = id.replaceAll("\\", "/");
  if (normalized.includes("/node_modules/gsap/")) return "vendor-gsap";
  if (/\/(?:packages|node_modules\/@framediff)\/studio-ui\/src\//.test(normalized)) return "framediff-studio-ui";
  if (/\/(?:packages|node_modules\/@framediff)\/studio-model\/src\//.test(normalized)) return "framediff-studio-model";
  if (
    /\/(?:packages|node_modules)\/framediff\/src\/studio-runtime\//.test(normalized) ||
    /\/(?:packages|node_modules)\/framediff\/src\/studio\//.test(normalized) ||
    /\/(?:packages|node_modules)\/framediff\/src\/gsap\/traces\.ts$/.test(normalized)
  ) {
    return "framediff-studio-runtime";
  }
  return undefined;
}

/** `git status --porcelain` lines → paths (strip status columns, rename arrows, quotes). */
function parsePorcelain(out: string): string[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      let p = line.slice(3);
      const arrow = p.indexOf(" -> ");
      if (arrow !== -1) p = p.slice(arrow + 4);
      return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
    });
}

export function framediffDev(options: FrameDiffDevOptions = {}): FrameDiffDevPlugin {
  return {
    name: "framediff-dev",
    config() {
      return {
        // Vite does not crawl module-worker entry points during its initial dependency scan.
        // Prebundle the encoder's only bare import up front so the first Bake cannot receive
        // a transient `504 Outdated Optimize Dep` while Vite discovers it on demand.
        //
        // The engine itself must NEVER be prebundled: exportVideo spawns its encode worker
        // via `new URL("./encodeWorker.ts", import.meta.url)`, and from a .vite/deps chunk
        // that URL 404s ("encode worker failed to start"). Git-dependency consumers alias
        // these ids into node_modules/framediff-monorepo, where the optimizer otherwise
        // picks them up; workspace examples resolve them as linked source, so the excludes
        // are a no-op there. `@babel/parser` is the excluded source's one pure-CJS dep and
        // still needs esbuild interop once the engine is served raw.
        optimizeDeps: {
          include: ["mp4-muxer", "@babel/parser"],
          exclude: [
            "framediff",
            "framediff/three",
            "framediff/gsap",
            "framediff/gsap/source",
            "framediff/studio-runtime",
            "@framediff/studio-model",
            "@framediff/studio-ui",
          ],
        },
        server: { fs: { allow: [PLUGIN_DIR] } },
        build: {
          // Optional heavyweight capabilities are lazy chunks. Keep the warning ceiling high
          // enough for the media decoder while package-level chunks below keep the eager Studio
          // surface comfortably bounded.
          chunkSizeWarningLimit: 800,
          rollupOptions: {
            output: {
              onlyExplicitManualChunks: false,
              manualChunks: framediffManualChunk,
            },
          },
        },
      };
    },
    configureServer(server) {
      const root = server.config.root;
      const assetStorage = resolveAssetStorage(root, options.cacheDir);
      const cacheDir = assetStorage.directory;
      if (assetStorage.mode === "git-lfs") ensureGitLfsAssetStorage(root);
      const sharedProjectDir = options.sharedProjectDir
        ? resolveLocalPath(root, options.sharedProjectDir)
        : !assetStorage.explicit ? linkedPrimaryProject(root) : null;
      const sharedCacheDir = sharedProjectDir ? path.join(sharedProjectDir, DEFAULT_CACHE_DIR) : null;
      const cacheReadDirs = [cacheDir, sharedCacheDir]
        .filter((dir): dir is string => !!dir)
        .filter((dir, index, all) => all.indexOf(dir) === index);
      const outDir = path.join(root, "out");

      // Cache writes must not trigger Vite reloads, especially now that the default
      // directory is visible and therefore no longer ignored as a dot-folder.
      fs.mkdirSync(cacheDir, { recursive: true });
      void server.watcher?.unwatch(cacheDir);
      if (sharedCacheDir) void server.watcher?.unwatch(sharedCacheDir);

      // The HTTP/CAS identity remains the content hash. The folder uses readable filenames,
      // and this index spans both the writable worktree cache and its read-only primary fallback.
      const cacheFilesByHash = new Map<string, string>();
      const indexCacheFiles = () => {
        cacheFilesByHash.clear();
        for (const dir of cacheReadDirs) {
          if (!fs.existsSync(dir)) continue;
          for (const name of fs.readdirSync(dir)) {
            if (name.endsWith(".meta.json")) continue;
            const hash = hashFromCacheName(name);
            if (hash && !cacheFilesByHash.has(hash)) cacheFilesByHash.set(hash, path.join(dir, name));
          }
        }
      };
      indexCacheFiles();
      const cachedFile = (name: string): string => {
        if (name.endsWith(".meta.json")) {
          const base = name.slice(0, -".meta.json".length);
          const dataFile = cachedFile(base);
          return `${dataFile}.meta.json`;
        }
        for (const dir of cacheReadDirs) {
          const exact = path.join(dir, name);
          if (fs.existsSync(exact)) return exact;
        }
        const hash = hashFromCacheName(name);
        let indexed = hash ? cacheFilesByHash.get(hash) : undefined;
        if (indexed && fs.existsSync(indexed)) return indexed;
        if (hash) {
          indexCacheFiles();
          indexed = cacheFilesByHash.get(hash);
          if (indexed && fs.existsSync(indexed)) return indexed;
        }
        return path.join(cacheDir, name);
      };
      const localCachedFile = (name: string): string => {
        const exact = path.join(cacheDir, name);
        if (fs.existsSync(exact)) return exact;
        const hash = hashFromCacheName(name);
        if (hash && fs.existsSync(cacheDir)) {
          const match = fs.readdirSync(cacheDir).find((entry) => hashFromCacheName(entry) === hash && !entry.endsWith(".meta.json"));
          if (match) return path.join(cacheDir, match);
        }
        return exact;
      };
      const cacheFileForWrite = (key: string, label?: string, mime?: string): string => {
        if (key.endsWith(".meta.json")) return `${localCachedFile(key.slice(0, -".meta.json".length))}.meta.json`;
        const hash = hashFromCacheName(key);
        if (!hash) return path.join(cacheDir, key);
        const existing = localCachedFile(hash);
        if (fs.existsSync(existing)) return existing;
        return path.join(cacheDir, readableCacheName(label ?? "artifact", hash, mime));
      };

      const handle = async (req: IncomingMessage, res: ServerResponse, next: NextFn) => {
        const u = req.url || "";
        const url = new URL(u, "http://localhost");

        // Vite only serves the linked worktree's public directory. Its ignored media lives in the
        // primary checkout, so fall back there for media files that are absent locally.
        if (sharedProjectDir && (req.method === "GET" || req.method === "HEAD") && !url.pathname.startsWith("/__")) {
          const current = safeChild(path.join(root, "public"), url.pathname);
          const shared = safeChild(path.join(sharedProjectDir, "public"), url.pathname);
          if (current && shared && !fs.existsSync(current) && MEDIA_MIME[path.extname(shared).toLowerCase()] && fs.existsSync(shared)) {
            return sendFile(req, res, shared);
          }
        }

        // --- source read/write -------------------------------------------
        if (url.pathname === "/__framediff/src") {
          const rel = url.searchParams.get("file");
          const abs = resolveSrc(root, rel);
          if (!abs) return json(res, 403, { error: "bad path" });
          if (req.method === "GET") {
            if (!fs.existsSync(abs)) return json(res, 404, { error: "not found" });
            const text = fs.readFileSync(abs, "utf8");
            return json(res, 200, { file: rel, text, hash: sourceHash(text) });
          }
          if (req.method === "PUT") {
            const body = await readBody(req);
            fs.writeFileSync(abs, body.toString("utf8")); // vite's watcher fires HMR
            return json(res, 200, { ok: true });
          }
          if (req.method === "DELETE") {
            if (!fs.existsSync(abs)) return json(res, 404, { error: "not found" });
            fs.unlinkSync(abs);
            return json(res, 200, { ok: true });
          }
        }

        if (url.pathname === "/__framediff/edit" && req.method === "POST") {
          let payload: { label?: unknown; groupId?: unknown; files?: unknown };
          try {
            payload = JSON.parse((await readBody(req)).toString("utf8")) as typeof payload;
          } catch {
            return json(res, 400, { ok: false, error: "Invalid JSON source transaction." });
          }
          if (typeof payload.label !== "string" || !payload.label.trim() || payload.label.length > 240) {
            return json(res, 400, { ok: false, error: "A short transaction label is required." });
          }
          if (payload.groupId != null && (typeof payload.groupId !== "string" || payload.groupId.length > 240)) {
            return json(res, 400, { ok: false, error: "Invalid transaction group id." });
          }
          if (!Array.isArray(payload.files) || payload.files.length === 0 || payload.files.length > 64) {
            return json(res, 400, { ok: false, error: "A source transaction needs between 1 and 64 files." });
          }

          const seen = new Set<string>();
          const entries: { request: SourceEditFileRequest; abs: string; before: SourceRevision }[] = [];
          for (const candidate of payload.files) {
            if (!candidate || typeof candidate !== "object") return json(res, 400, { ok: false, error: "Invalid source transaction file." });
            const request = candidate as Partial<SourceEditFileRequest>;
            const ownsExpected = Object.prototype.hasOwnProperty.call(request, "expectedHash");
            if (
              typeof request.file !== "string"
              || !ownsExpected
              || (request.expectedHash !== null && typeof request.expectedHash !== "string")
              || (request.text !== null && typeof request.text !== "string")
            ) return json(res, 400, { ok: false, error: "Each source file needs file, expectedHash, and text." });
            const abs = resolveSrc(root, request.file);
            if (!abs) return json(res, 403, { ok: false, error: `Refused source path: ${request.file}` });
            if (seen.has(abs)) return json(res, 400, { ok: false, error: `Duplicate source path: ${request.file}` });
            seen.add(abs);
            const typed = request as SourceEditFileRequest;
            entries.push({ request: typed, abs, before: sourceRevision(typed.file, abs) });
          }

          const conflicts = entries.flatMap(({ request, before }) => request.expectedHash === before.hash
            ? []
            : [{ file: request.file, expectedHash: request.expectedHash, actualHash: before.hash }]);
          if (conflicts.length) {
            return json(res, 409, { ok: false, error: "Source changed since it was inspected.", conflicts });
          }

          const id = crypto.randomUUID();
          try {
            writeSourceTransaction(entries, id);
          } catch (error) {
            return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          const after = entries.map(({ request, abs }) => sourceRevision(request.file, abs));
          return json(res, 200, {
            ok: true,
            receipt: {
              id,
              label: payload.label.trim(),
              ...(typeof payload.groupId === "string" && payload.groupId ? { groupId: payload.groupId } : {}),
              before: entries.map((entry) => entry.before),
              after,
            },
          });
        }

        // --- cache listing (with .meta.json sidecars folded in) -----------
        if (url.pathname === "/__framediff/cache" && req.method === "GET") {
          const entries: { name: string; filename: string; contentHash?: string; size: number; mtimeMs: number; meta?: unknown }[] = [];
          const names = new Set<string>();
          for (const dir of cacheReadDirs) {
            if (!dir || !fs.existsSync(dir)) continue;
            for (const filename of fs.readdirSync(dir)) {
              if (filename.endsWith(".meta.json")) continue;
              const file = path.join(dir, filename);
              const st = fs.statSync(file);
              if (!st.isFile()) continue;
              const contentHash = hashFromCacheName(filename) ?? undefined;
              const name = contentHash ?? filename;
              if (names.has(name)) continue;
              names.add(name);
              const entry: (typeof entries)[number] = {
                name,
                filename,
                ...(contentHash ? { contentHash } : {}),
                size: st.size,
                mtimeMs: st.mtimeMs,
              };
              const sidecar = `${file}.meta.json`;
              if (fs.existsSync(sidecar)) {
                try {
                  entry.meta = JSON.parse(fs.readFileSync(sidecar, "utf8"));
                } catch {
                  /* corrupt sidecar — list the entry without meta */
                }
              }
              entries.push(entry);
            }
          }
          return json(res, 200, { entries, directory: cacheDir, storage: assetStorage.mode });
        }

        if (url.pathname === "/__framediff/cache/reveal" && req.method === "POST") {
          const hash = url.searchParams.get("hash");
          if (!hash || !HASH_KEY.test(hash)) return json(res, 400, { error: "valid content hash required" });
          const file = cachedFile(hash);
          if (!fs.existsSync(file)) return json(res, 404, { error: "cache entry not found" });
          try {
            await revealFileOnDisk(file);
            return json(res, 200, { ok: true });
          } catch (e) {
            return json(res, 500, { error: String((e as Error).message) });
          }
        }

        // --- asset manifest + ingest -----------------------------------------
        // framediff.assets.json (uuid → { name, contentHash, mime, bytes, sources[] });
        // Bytes live in the configured local cache by content hash and are served by the
        // stable CAS route below (the browser URL does not expose the disk folder name).
        const manifestPath = path.join(root, "framediff.assets.json");
        const readManifest = (): { version: 1; assets: Record<string, unknown> } => {
          try {
            return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          } catch {
            return { version: 1, assets: {} };
          }
        };
        const ingestBytes = (buf: Buffer, name: string) => {
          const ext = path.extname(name).toLowerCase();
          const mime = MEDIA_MIME[ext];
          if (!mime) throw new Error(`unsupported media type: ${ext || "(none)"}`);
          const hash = "sha256:" + crypto.createHash("sha256").update(buf).digest("hex");
          fs.mkdirSync(cacheDir, { recursive: true });
          const casFile = cacheFileForWrite(hash, name, mime);
          if (!fs.existsSync(casFile)) {
            fs.writeFileSync(casFile, buf);
            cacheFilesByHash.set(hash, casFile);
          }
          const manifest = readManifest();
          // same bytes already ingested → return the existing entry, don't duplicate
          for (const [id, e] of Object.entries(manifest.assets) as [string, { name?: string; contentHash?: string; aliases?: string[] }][]) {
            if (e.contentHash !== hash) continue;
            if (e.name && e.name !== name && !e.aliases?.includes(name)) {
              e.aliases = [...(e.aliases ?? []), name];
              fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
            }
            return { id, entry: e, existed: true };
          }
          const id = crypto.randomUUID();
          const entry = {
            name,
            contentHash: hash,
            mime,
            bytes: buf.length,
            sources: [`/__framediff-cache/${encodeURIComponent(hash)}`],
          };
          manifest.assets[id] = entry;
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
          return { id, entry, existed: false };
        };
        if (url.pathname === "/__framediff/assets" && req.method === "GET") {
          return json(res, 200, readManifest());
        }
        if (url.pathname === "/__framediff/assets/ingest" && req.method === "POST") {
          try {
            const { path: p, name } = JSON.parse((await readBody(req)).toString("utf8"));
            if (typeof p !== "string" || !p) return json(res, 400, { error: "path required" });
            const abs = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
            // async + timeout: a permission-gated path (macOS TCC) can hang reads forever, and a
            // sync read here would freeze the whole dev server's event loop
            const buf = await Promise.race([
              fs.promises.readFile(abs),
              new Promise<never>((_, rej) =>
                setTimeout(() => rej(new Error("read timed out — is the path permission-gated? Copy the file somewhere readable or drag-drop it into the Studio instead")), 8000),
              ),
            ]);
            return json(res, 200, ingestBytes(buf, name || path.basename(abs)));
          } catch (e) {
            return json(res, 400, { error: String((e as Error).message) });
          }
        }
        if (url.pathname === "/__framediff/assets/upload" && req.method === "POST") {
          try {
            const name = url.searchParams.get("name") || "untitled";
            return json(res, 200, ingestBytes(await readBody(req), name));
          } catch (e) {
            return json(res, 400, { error: String((e as Error).message) });
          }
        }

        // --- git ------------------------------------------------------------
        if (url.pathname === "/__framediff/git" && req.method === "GET") {
          try {
            const out = await git(root, ["status", "--porcelain", "--", "."]);
            return json(res, 200, { dirty: parsePorcelain(out) });
          } catch (e) {
            return json(res, 500, { error: String((e as Error).message) });
          }
        }
        if (url.pathname === "/__framediff/git/commit" && req.method === "POST") {
          try {
            const { message } = JSON.parse((await readBody(req)).toString("utf8"));
            if (typeof message !== "string" || !message) return json(res, 400, { error: "message required" });
            await git(root, ["add", "-A", "."]);
            await git(root, ["commit", "-m", message]);
            const hash = (await git(root, ["rev-parse", "--short", "HEAD"])).trim();
            return json(res, 200, { hash });
          } catch (e) {
            return json(res, 500, { error: String((e as Error).message) });
          }
        }

        // --- provider secrets (write-only in, last4 out) ----------------------
        if (url.pathname === "/__framediff/secrets") {
          if (req.method === "GET") {
            const providers: Record<string, { set: boolean; last4?: string; source?: string }> = {};
            for (const p of KNOWN_PROVIDERS) {
              const k = providerKey(root, p);
              providers[p] = k ? { set: true, last4: k.key.slice(-4), source: k.source } : { set: false };
            }
            return json(res, 200, { providers, file: ".framediff/secrets.json" });
          }
          if (req.method === "PUT") {
            try {
              const { provider, key } = JSON.parse((await readBody(req)).toString("utf8")) as {
                provider?: string; key?: string;
              };
              if (!provider || !KNOWN_PROVIDERS.includes(provider as (typeof KNOWN_PROVIDERS)[number])) {
                return json(res, 400, { error: "unknown provider" });
              }
              const normalizedKey = typeof key === "string" ? key.trim() : "";
              if (normalizedKey.length < 8) return json(res, 400, { error: "key looks too short" });
              const file = secretsFile(root);
              fs.mkdirSync(path.dirname(file), { recursive: true });
              const all = readSecretsRaw(root);
              all[provider] = { key: normalizedKey };
              fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
              fs.chmodSync(file, 0o600);
              return json(res, 200, { ok: true, last4: normalizedKey.slice(-4) });
            } catch (e) {
              return json(res, 400, { error: String((e as Error).message) });
            }
          }
          if (req.method === "DELETE") {
            try {
              const { provider } = JSON.parse((await readBody(req)).toString("utf8")) as { provider?: string };
              if (!provider || !KNOWN_PROVIDERS.includes(provider as (typeof KNOWN_PROVIDERS)[number])) {
                return json(res, 400, { error: "unknown provider" });
              }
              const file = secretsFile(root);
              const all = readSecretsRaw(root);
              delete all[provider];
              fs.mkdirSync(path.dirname(file), { recursive: true });
              fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
              fs.chmodSync(file, 0o600);
              return json(res, 200, { ok: true });
            } catch (e) {
              return json(res, 400, { error: String((e as Error).message) });
            }
          }
        }

        // --- generation: verify key / submit / poll jobs ----------------------
        if (url.pathname === "/__framediff/gen/verify" && req.method === "GET") {
          const provider = url.searchParams.get("provider") ?? "fal";
          const k = providerKey(root, provider);
          if (!k) return json(res, 200, { ok: false, authed: false, error: "no key stored" });
          if (provider === "byteplus") {
            try {
              // Listing one task is read-only and verifies both the regional API key and
              // ModelArk access without consuming generation credits.
              const r = await fetch(`${BYTEPLUS_ARK_BASE}/contents/generations/tasks?page_size=1`, {
                headers: { authorization: `Bearer ${k.key}` },
              });
              const body = (await r.text()).slice(0, 500);
              if (r.status === 401 || r.status === 403) {
                let detail = body;
                try {
                  const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
                  detail = parsed.error?.message ?? parsed.message ?? body;
                } catch { /* raw */ }
                return json(res, 200, { ok: false, authed: false, error: detail || `BytePlus rejected the key (${r.status})` });
              }
              return json(res, 200, {
                ok: true,
                authed: true,
                ...(r.ok ? {} : { note: `Key accepted; ModelArk task-list probe returned ${r.status}.` }),
              });
            } catch (e) {
              return json(res, 200, { ok: false, authed: false, error: String((e as Error).message) });
            }
          }
          if (provider !== "fal") return json(res, 200, { ok: true, authed: true, note: "stored — no live verification adapter" });
          try {
            // a status probe on a nonexistent request: 401 = bad key; anything else = authed
            const r = await fetch(
              "https://queue.fal.run/bytedance/seedance-2.0/fast/text-to-video/requests/00000000-0000-0000-0000-000000000000/status",
              { headers: { authorization: `Key ${k.key}` } },
            );
            const body = (await r.text()).slice(0, 300);
            if (r.status === 401) return json(res, 200, { ok: false, authed: false, error: "invalid key (401)" });
            const locked = /locked|exhausted balance/i.test(body);
            if (locked) {
              let detail = body;
              try { detail = (JSON.parse(body) as { detail?: string }).detail ?? body; } catch { /* raw */ }
              return json(res, 200, { ok: false, authed: true, error: detail });
            }
            return json(res, 200, { ok: true, authed: true });
          } catch (e) {
            return json(res, 200, { ok: false, authed: false, error: String((e as Error).message) });
          }
        }

        if (url.pathname === "/__framediff/gen/submit" && req.method === "POST") {
          let attempt: GenJobRecord | null = null;
          try {
            const body = JSON.parse((await readBody(req)).toString("utf8")) as {
              provider?: GenProvider;
              gen?: string;
              endpoint?: string;
              recipeHash?: string;
              input?: Record<string, unknown>;
              refs?: { kind: GenRefKind; src: string; authoredSrc: string; mime?: string; name?: string; field?: string; many?: boolean; adapt?: GenInputProvenance["adapt"] }[];
              recipe?: GenRecipeSnapshot;
              presentation?: GenPresentationSnapshot;
            };
            const { gen, endpoint, recipeHash } = body;
            const provider = body.provider ?? body.recipe?.provider ?? "fal";
            if (!gen || !endpoint || !recipeHash || !body.input || !body.recipe) {
              return json(res, 400, { error: "gen, endpoint, recipeHash, input, recipe required" });
            }
            if (!/^[a-zA-Z0-9/_.-]+$/.test(endpoint)) return json(res, 400, { error: "bad endpoint" });
            if (provider !== "fal" && provider !== "byteplus" && provider !== "elevenlabs") {
              return json(res, 400, { error: "unsupported generation provider" });
            }
            if (
              provider === "elevenlabs"
              && endpoint !== "v1/text-to-voice/design"
              && !/^v1\/text-to-speech\/[a-zA-Z0-9_-]+$/.test(endpoint)
            ) {
              return json(res, 400, { error: "unsupported ElevenLabs endpoint" });
            }
            const k = providerKey(root, provider);
            if (!k) return json(res, 400, { error: `no ${provider} key — add one under SERVICES` });
            const falStorageKey = provider === "fal" ? k : providerKey(root, "fal");

            // resolve refs (asset:// or cache paths) into URLs the model can read
            const manifest = readManifest();
            const refToUrl = async (ref: { kind: string; src: string; mime?: string; name?: string }): Promise<string> => {
              let src = ref.src;
              if (src.startsWith("asset://")) {
                const entry = (manifest.assets as Record<string, { contentHash?: string; mime?: string; name?: string }>)[src.slice("asset://".length)];
                if (!entry?.contentHash) throw new Error(`unknown asset ref ${src}`);
                src = `/__framediff-cache/${entry.contentHash}`;
              }
              if (src.startsWith("/__framediff-cache/")) {
                const hash = decodeURIComponent(src.slice("/__framediff-cache/".length));
                const file = cachedFile(safe(hash));
                if (!fs.existsSync(file)) throw new Error(`ref bytes not in cache: ${hash.slice(0, 24)}…`);
                const buf = fs.readFileSync(file);
                const entry = Object.values(manifest.assets as Record<string, { contentHash?: string; mime?: string; name?: string }>).find((e) => e.contentHash === hash);
                const mime = ref.mime ?? entry?.mime ?? "application/octet-stream";
                const name = ref.name ?? entry?.name ?? "ref";
                if (falStorageKey) {
                  try {
                    // fal storage is only a public-file relay for direct BytePlus requests;
                    // generation itself still goes straight to ModelArk.
                    return await falUpload(falStorageKey.key, buf, mime, name);
                  } catch (e) {
                    if (buf.length > DATA_URI_MAX) {
                      throw new Error(`ref upload failed and ${name} is too large to inline: ${String((e as Error).message)}`);
                    }
                  }
                }
                if (buf.length <= DATA_URI_MAX) return `data:${mime};base64,${buf.toString("base64")}`;
                throw new Error(`${name} needs a public URL for ${provider}; configure FAL as an upload relay or use an http(s) asset`);
              }
              return src; // http(s)/data: passthrough
            };

            const input: Record<string, unknown> = { ...body.input };
            const refs = body.refs ?? [];
            const inputs: GenInputProvenance[] = refs.map((ref) => {
              let contentHash: string | undefined;
              if (ref.src.startsWith("asset://")) {
                contentHash = (manifest.assets as Record<string, { contentHash?: string }>)[ref.src.slice("asset://".length)]?.contentHash;
              } else if (ref.src.startsWith("/__framediff-cache/")) {
                contentHash = decodeURIComponent(ref.src.slice("/__framediff-cache/".length));
              }
              return {
                kind: ref.kind,
                src: ref.authoredSrc,
                ...(contentHash ? { contentHash } : {}),
                ...(ref.adapt ? { adapt: ref.adapt } : {}),
              };
            });
            const jobs = readJobs(root);
            normalizeJobTakes(jobs);
            attempt = {
              id: crypto.randomUUID(),
              provider,
              gen,
              endpoint,
              recipeHash,
              status: "queued",
              // This is the authoritative acceptance point. Include older manifest-only
              // provenance because CAS assets can outlive or predate the attempt ledger.
              take: nextJobTake(jobs, gen, manifest),
              ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
              at: new Date().toISOString(),
              recipe: body.recipe,
              inputs,
              ...(body.presentation ? { presentation: body.presentation } : {}),
            };
            writeJobs(root, [...jobs, attempt]);
            if (provider === "byteplus") {
              const prompt = typeof input.prompt === "string" ? input.prompt : "";
              delete input.prompt;
              const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
              for (const ref of refs) {
                const refUrl = await refToUrl(ref);
                if (ref.kind === "video") {
                  content.push({ type: "video_url", video_url: { url: refUrl }, role: "reference_video" });
                } else if (ref.kind === "audio") {
                  content.push({ type: "audio_url", audio_url: { url: refUrl }, role: "reference_audio" });
                } else {
                  content.push({
                    type: "image_url",
                    image_url: { url: refUrl },
                    role: ref.kind === "endImage" ? "last_frame" : "reference_image",
                  });
                }
              }
              const directInput = { model: endpoint, content, ...input };
              const r = await fetch(`${BYTEPLUS_ARK_BASE}/contents/generations/tasks`, {
                method: "POST",
                headers: { authorization: `Bearer ${k.key}`, "content-type": "application/json" },
                body: JSON.stringify(directInput),
              });
              const text = await r.text();
              if (!r.ok) {
                let detail = text.slice(0, 500);
                try {
                  const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
                  detail = parsed.error?.message ?? parsed.message ?? detail;
                } catch { /* raw */ }
                attempt.status = "failed";
                attempt.error = detail;
                attempt.doneAt = new Date().toISOString();
                saveJob(root, attempt);
                return json(res, r.status, { error: detail, job: attempt });
              }
              const task = JSON.parse(text) as { id?: string };
              if (!task.id) throw new Error("BytePlus accepted the request but returned no task id");
              attempt.providerJobId = task.id;
              attempt.statusUrl = `${BYTEPLUS_ARK_BASE}/contents/generations/tasks/${encodeURIComponent(task.id)}`;
              attempt.responseUrl = attempt.statusUrl;
              saveJob(root, attempt);
              return json(res, 200, { job: attempt });
            }

            if (provider === "elevenlabs") {
              // ElevenLabs answers synchronously — audio bytes for TTS, JSON previews for
              // Voice Design — so there is no queue to poll: the take lands here and the
              // job is already `done` when this response returns.
              const isDesign = endpoint === "v1/text-to-voice/design";
              const r = await fetch(`${ELEVENLABS_BASE}/${endpoint}`, {
                method: "POST",
                headers: {
                  "xi-api-key": k.key,
                  "content-type": "application/json",
                  accept: isDesign ? "application/json" : "audio/mpeg",
                },
                body: JSON.stringify(input),
              });
              if (!r.ok) {
                const text = await r.text();
                let detail: unknown = text.slice(0, 400);
                try {
                  const parsed = JSON.parse(text) as { detail?: unknown; message?: string };
                  const d = parsed.detail as { message?: string } | string | undefined;
                  detail = (typeof d === "string" ? d : d?.message) ?? parsed.message ?? detail;
                } catch { /* raw */ }
                attempt.status = "failed";
                attempt.error = typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400);
                attempt.doneAt = new Date().toISOString();
                saveJob(root, attempt);
                return json(res, r.status, { error: attempt.error, job: attempt });
              }

              // Land bytes as a take, mirroring the queue path's finalize step.
              const landTake = (job: GenJobRecord, buf: Buffer, ext: string, extra?: Record<string, unknown>) => {
                const takeNo = job.take ?? 1;
                const { id, entry } = ingestBytes(buf, `${job.gen}.take${takeNo}.${ext}`);
                const withGen = readManifest();
                const target = withGen.assets[id] as { generator?: unknown };
                if (!(entry as { generator?: { take?: number } }).generator?.take && target) {
                  target.generator = {
                    gen: job.gen,
                    take: takeNo,
                    recipeHash: job.recipeHash,
                    endpoint: job.endpoint,
                    recipe: job.recipe,
                    inputs: job.inputs,
                    presentation: job.presentation,
                    requestId: job.id,
                    seed: job.seed,
                    outputKind: "audio",
                    at: new Date().toISOString(),
                    ...(extra ?? {}),
                  };
                  fs.writeFileSync(manifestPath, JSON.stringify(withGen, null, 2) + "\n");
                }
                job.status = "done";
                job.assetId = id;
                job.outputKind = "audio";
                if (extra) job.takeMetadata = { ...extra };
                job.doneAt = new Date().toISOString();
              };

              if (!isDesign) {
                const contentType = r.headers.get("content-type")?.split(";", 1)[0];
                if (contentType && !contentType.startsWith("audio/")) {
                  throw new Error(`ElevenLabs TTS returned ${contentType}, not audio`);
                }
                const audio = Buffer.from(await r.arrayBuffer());
                if (!audio.length) throw new Error("ElevenLabs TTS returned empty audio");
                landTake(attempt, audio, "mp3");
                saveJob(root, attempt);
                return json(res, 200, { job: attempt });
              }

              // Voice Design: every candidate becomes its own take, so the takes rail is
              // the audition. Each take records the generated_voice_id that produced it —
              // pin one, then POST /gen/voice/create to make it a permanent voice.
              const out = (await r.json().catch(() => ({}))) as {
                previews?: { audio_base_64?: string; generated_voice_id?: string; media_type?: string; duration_secs?: number }[];
                text?: string;
              };
              const previews = (out.previews ?? []).filter((p) => p.audio_base_64);
              if (!previews.length) throw new Error("Voice Design returned no previews");
              const siblings: GenJobRecord[] = [];
              // The provider response is asynchronous: another submission may have
              // claimed numbers while this design request was pending. Reserve all
              // sibling numbers from the latest ledger/manifest in one synchronous pass.
              let nextSiblingTake = nextJobTake(readJobs(root), attempt!.gen, readManifest());
              previews.forEach((preview, index) => {
                const job = index === 0
                  ? attempt!
                  : { ...attempt!, id: crypto.randomUUID(), take: nextSiblingTake++ };
                const ext = preview.media_type?.includes("wav") ? "wav" : "mp3";
                landTake(job, Buffer.from(preview.audio_base_64!, "base64"), ext, {
                  generatedVoiceId: preview.generated_voice_id,
                  sampleText: out.text,
                  durationSecs: preview.duration_secs,
                });
                if (index > 0) siblings.push(job);
              });
              const allJobs = readJobs(root).filter((j) => j.id !== attempt!.id);
              writeJobs(root, [...allJobs, attempt!, ...siblings]);
              return json(res, 200, { job: attempt, takes: [attempt, ...siblings].length });
            }

            if (refs.some((r) => r.field)) {
              // explicit mapping (the model registry names the provider field per ref —
              // required for endpoints whose mode isn't a path suffix, e.g. veo3.1 t2v)
              if (!/^[a-z0-9_]+$/i.test(refs.map((r) => r.field ?? "f").join(""))) {
                return json(res, 400, { error: "bad ref field" });
              }
              for (const r of refs) {
                if (!r.field) continue;
                const u = await refToUrl(r);
                if (r.many) {
                  const arr = (input[r.field] as unknown[] | undefined) ?? [];
                  arr.push(u);
                  input[r.field] = arr;
                } else {
                  input[r.field] = u;
                }
              }
            } else if (endpoint.endsWith("/image-to-video")) {
              const start = refs.find((r) => r.kind === "image");
              const end = refs.find((r) => r.kind === "endImage");
              if (!start) return json(res, 400, { error: "image-to-video needs an image ref" });
              input.image_url = await refToUrl(start);
              if (end) input.end_image_url = await refToUrl(end);
            } else if (endpoint.endsWith("/reference-to-video")) {
              const urlsOf = async (kinds: string[]) =>
                Promise.all(refs.filter((r) => kinds.includes(r.kind)).map(refToUrl));
              const images = await urlsOf(["image", "endImage"]);
              const videos = await urlsOf(["video"]);
              const audios = await urlsOf(["audio"]);
              if (images.length) input.image_urls = images;
              if (videos.length) input.video_urls = videos;
              if (audios.length) input.audio_urls = audios;
            }

            const r = await fetch(`https://queue.fal.run/${endpoint}`, {
              method: "POST",
              headers: { authorization: `Key ${k.key}`, "content-type": "application/json" },
              body: JSON.stringify(input),
            });
            const text = await r.text();
            if (!r.ok) {
              let detail = text.slice(0, 400);
              try { detail = (JSON.parse(text) as { detail?: string }).detail ?? detail; } catch { /* raw */ }
              attempt.status = "failed";
              attempt.error = detail;
              attempt.doneAt = new Date().toISOString();
              saveJob(root, attempt);
              return json(res, r.status, { error: detail, job: attempt });
            }
            const q = JSON.parse(text) as { request_id: string; status_url?: string; response_url?: string };
            attempt.providerJobId = q.request_id;
            attempt.statusUrl = q.status_url ?? `https://queue.fal.run/${endpoint}/requests/${q.request_id}/status`;
            attempt.responseUrl = q.response_url ?? `https://queue.fal.run/${endpoint}/requests/${q.request_id}`;
            saveJob(root, attempt);
            return json(res, 200, { job: attempt });
          } catch (e) {
            const error = String((e as Error).message);
            if (attempt) {
              attempt.status = "failed";
              attempt.error = error;
              attempt.doneAt = new Date().toISOString();
              saveJob(root, attempt);
            }
            return json(res, 500, { error, ...(attempt ? { job: attempt } : {}) });
          }
        }

        // Real voice ids for the account — `voice` on an elevenlabs-direct recipe is an id,
        // not a display name, and ids are account-specific, so they can only be discovered.
        if (url.pathname === "/__framediff/gen/voices" && req.method === "GET") {
          const k = providerKey(root, "elevenlabs");
          if (!k) return json(res, 400, { error: "no elevenlabs key — add one under SERVICES" });
          const r = await fetch(`${ELEVENLABS_BASE}/v1/voices`, { headers: { "xi-api-key": k.key } });
          const text = await r.text();
          if (!r.ok) return json(res, r.status, { error: text.slice(0, 300) });
          const out = JSON.parse(text) as {
            voices?: { voice_id?: string; name?: string; category?: string; description?: string; preview_url?: string }[];
          };
          return json(res, 200, {
            voices: (out.voices ?? []).map((v) => ({
              voice_id: v.voice_id,
              name: v.name,
              category: v.category,
              description: v.description,
              // ElevenLabs hosts a sample per voice, so auditioning costs nothing.
              preview_url: v.preview_url,
            })),
          });
        }

        // Promote a Voice Design candidate into a permanent library voice. The take you
        // pinned carries its generated_voice_id in the manifest's generator block; the
        // voice_id this returns is what an elevenlabs-direct recipe's `voice` should hold.
        if (url.pathname === "/__framediff/gen/voice/create" && req.method === "POST") {
          const k = providerKey(root, "elevenlabs");
          if (!k) return json(res, 400, { error: "no elevenlabs key — add one under SERVICES" });
          const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as {
            generatedVoiceId?: string;
            name?: string;
            description?: string;
          };
          if (!body.generatedVoiceId || !body.name || !body.description) {
            return json(res, 400, { error: "generatedVoiceId, name, and description required" });
          }
          if (body.description.length < 20 || body.description.length > 1000) {
            return json(res, 400, { error: "description must be between 20 and 1000 characters" });
          }
          const r = await fetch(`${ELEVENLABS_BASE}/v1/text-to-voice`, {
            method: "POST",
            headers: { "xi-api-key": k.key, "content-type": "application/json" },
            body: JSON.stringify({
              voice_name: body.name,
              voice_description: body.description,
              generated_voice_id: body.generatedVoiceId,
            }),
          });
          const text = await r.text();
          if (!r.ok) return json(res, r.status, { error: text.slice(0, 300) });
          const out = JSON.parse(text) as { voice_id?: string; name?: string; category?: string };
          return json(res, 200, { voice_id: out.voice_id, name: out.name, category: out.category });
        }

        if (url.pathname === "/__framediff/gen/jobs" && req.method === "GET") {
          const gen = url.searchParams.get("gen");
          const hasLedger = fs.existsSync(jobsFile(root));
          const hasLegacyLedger = fs.existsSync(legacyJobsFile(root));
          const jobs = readJobs(root);
          const initialJobStates = new Map(jobs.map((job) => [job.id, JSON.stringify(job)]));
          let changed = normalizeJobTakes(jobs) || (!hasLedger && hasLegacyLedger);
          const finalizeTake = async (
            job: GenJobRecord,
            artifact: { url: string; content_type?: string; file_name?: string },
            outputKind: "video" | "image" | "audio",
            seed?: number,
          ): Promise<void> => {
            const media = await fetch(artifact.url);
            if (!media.ok) throw new Error(`take download ${media.status}`);
            const buf = Buffer.from(await media.arrayBuffer());
            const mime = artifact.content_type ?? media.headers.get("content-type")?.split(";", 1)[0]
              ?? (outputKind === "video" ? "video/mp4" : outputKind === "audio" ? "audio/mpeg" : "image/jpeg");
            const namedExt = path.extname(artifact.file_name ?? "").slice(1).toLowerCase();
            const mimeExt = extensionForMime(mime).slice(1);
            const extension = /^[a-z0-9]{2,5}$/.test(namedExt)
              ? namedExt
              : mimeExt || (outputKind === "video" ? "mp4" : outputKind === "audio" ? "mp3" : "jpg");
            const takeNo = job.take ?? nextJobTake(jobs, job.gen, readManifest());
            const { id, entry } = ingestBytes(buf, `${job.gen}.take${takeNo}.${extension}`);
            const withGen = readManifest();
            const target = withGen.assets[id] as { generator?: unknown };
            const existingGen = (entry as { generator?: { take?: number } }).generator;
            if (!existingGen?.take && target) {
              target.generator = {
                gen: job.gen,
                take: takeNo,
                recipeHash: job.recipeHash,
                endpoint: job.endpoint,
                recipe: job.recipe,
                inputs: job.inputs,
                presentation: job.presentation,
                requestId: job.id,
                seed,
                outputKind,
                at: new Date().toISOString(),
              };
              fs.writeFileSync(manifestPath, JSON.stringify(withGen, null, 2) + "\n");
            }
            job.status = "done";
            job.take ??= takeNo;
            job.assetId = id;
            job.seed = seed;
            job.outputKind = outputKind;
            job.doneAt = new Date().toISOString();
            changed = true;
          };
          for (const job of jobs) {
            if (job.status !== "queued" && job.status !== "running") continue;
            if (finalizing.has(job.id)) continue;
            const provider = job.provider ?? "fal";
            const k = providerKey(root, provider);
            if (!k) continue;
            if (!job.statusUrl || !job.responseUrl) continue;
            finalizing.add(job.id);
            try {
              const authorization = provider === "byteplus" ? `Bearer ${k.key}` : `Key ${k.key}`;
              const s = await fetch(job.statusUrl, { headers: { authorization } });
              if (provider === "byteplus") {
                const task = (await s.json().catch(() => ({}))) as {
                  status?: string;
                  content?: { video_url?: string };
                  seed?: number;
                  error?: { code?: string; message?: string } | string;
                  message?: string;
                };
                if (!s.ok) {
                  job.status = "failed";
                  job.error = `status ${s.status}: ${
                    typeof task.error === "string" ? task.error : task.error?.message ?? task.message ?? JSON.stringify(task).slice(0, 300)
                  }`;
                  job.doneAt = new Date().toISOString();
                  changed = true;
                } else if (task.status === "succeeded" && task.content?.video_url) {
                  await finalizeTake(job, { url: task.content.video_url }, "video", task.seed);
                } else if (task.status === "failed" || task.status === "cancelled") {
                  job.status = "failed";
                  job.error = typeof task.error === "string"
                    ? task.error
                    : task.error?.message ?? task.message ?? `BytePlus task ${task.status}`;
                  job.doneAt = new Date().toISOString();
                  changed = true;
                } else if (job.status !== "running") {
                  job.status = "running";
                  changed = true;
                }
                continue;
              }
              const st = (await s.json().catch(() => ({}))) as { status?: string };
              if (!s.ok) {
                job.status = "failed";
                job.error = `status ${s.status}: ${JSON.stringify(st).slice(0, 200)}`;
                job.doneAt = new Date().toISOString();
                changed = true;
              } else if (st.status === "IN_PROGRESS" && job.status !== "running") {
                job.status = "running";
                changed = true;
              } else if (st.status === "COMPLETED") {
                const rr = await fetch(job.responseUrl, { headers: { authorization } });
                const out = (await rr.json().catch(() => ({}))) as {
                  video?: { url?: string; content_type?: string; file_name?: string };
                  audio?: { url?: string; content_type?: string; file_name?: string };
                  image?: { url?: string; content_type?: string; file_name?: string };
                  images?: { url?: string; content_type?: string; file_name?: string }[];
                  seed?: number;
                  detail?: unknown;
                };
                const artifact = out.video ?? out.audio ?? out.images?.[0] ?? out.image;
                const outputKind: "video" | "image" | "audio" = out.video
                  ? "video"
                  : out.audio
                    ? "audio"
                    : "image";
                if (!rr.ok || !artifact?.url) {
                  job.status = "failed";
                  job.error = `result ${rr.status}: ${JSON.stringify(out.detail ?? out).slice(0, 300)}`;
                  job.doneAt = new Date().toISOString();
                  changed = true;
                } else {
                  await finalizeTake(job, artifact as { url: string; content_type?: string; file_name?: string }, outputKind, out.seed);
                }
              }
            } catch (e) {
              job.status = "failed";
              job.error = String((e as Error).message);
              job.doneAt = new Date().toISOString();
              changed = true;
            } finally {
              finalizing.delete(job.id);
            }
          }
          // Provider polling awaits remote I/O. A submission can be accepted while those
          // awaits are in flight, so `jobs` is only a polling snapshot by this point. Merge
          // the updated records into the latest ledger instead of writing the snapshot and
          // accidentally deleting attempts accepted during the poll.
          const latestJobs = readJobs(root);
          const polledById = new Map(jobs.map((job) => [job.id, job]));
          const changedJobIds = new Set(jobs
            .filter((job) => initialJobStates.get(job.id) !== JSON.stringify(job))
            .map((job) => job.id));
          const latestIds = new Set(latestJobs.map((job) => job.id));
          const mergedJobs = latestJobs.map((job) => changedJobIds.has(job.id) ? polledById.get(job.id) ?? job : job);
          for (const job of jobs) {
            if (!latestIds.has(job.id)) mergedJobs.push(job);
          }
          const normalizedMergedJobs = normalizeJobTakes(mergedJobs);
          if (changed || normalizedMergedJobs || (!hasLedger && hasLegacyLedger)) writeJobs(root, mergedJobs);
          const m = readManifest();
          // The ledger is authoritative for attempt identity. Do not project completed
          // takes solely from manifest entries: CAS deduplication can make two attempts
          // share one asset while both numbered attempts must remain visible/pinnable.
          const takesByTake = new Map<number, unknown>();
          for (const job of mergedJobs) {
            if (job.gen !== gen || job.status !== "done" || job.take == null || !job.assetId) continue;
            const entry = m.assets[job.assetId] as { contentHash?: string; bytes?: number; mime?: string; generator?: Record<string, unknown> } | undefined;
            if (!entry?.contentHash) continue;
            takesByTake.set(job.take, {
              assetId: job.assetId,
              contentHash: entry.contentHash,
              bytes: entry.bytes,
              mime: entry.mime,
              generator: {
                ...(entry.generator ?? {}),
                gen: job.gen,
                take: job.take,
                recipeHash: job.recipeHash,
                endpoint: job.endpoint,
                recipe: job.recipe,
                inputs: job.inputs,
                presentation: job.presentation,
                requestId: job.id,
                seed: job.seed,
                outputKind: job.outputKind,
                at: job.at,
                ...(job.takeMetadata ?? {}),
              },
            });
          }
          // Preserve manifest-only legacy takes until their ledger records are migrated.
          for (const [assetId, e] of Object.entries(m.assets) as [string, { contentHash?: string; bytes?: number; mime?: string; generator?: { gen?: string; take?: number } }][]) {
            if (gen && e.generator?.gen === gen && e.generator.take != null && !takesByTake.has(e.generator.take)) {
              takesByTake.set(e.generator.take, { assetId, contentHash: e.contentHash, bytes: e.bytes, mime: e.mime, generator: e.generator });
            }
          }
          const takes = [...takesByTake.entries()].sort(([left], [right]) => left - right).map(([, take]) => take);
          return json(res, 200, {
            jobs: gen ? mergedJobs.filter((j) => j.gen === gen) : mergedJobs,
            takes,
          });
        }

        // --- HttpFolderCAS + saved renders (byte-compatible with the old
        // inline example plugin) ---------------------------------------------
        if (url.pathname.startsWith("/__framediff-cache/")) {
          const name = safe(url.pathname.slice("/__framediff-cache/".length));
          if (req.method === "PUT") {
            fs.mkdirSync(cacheDir, { recursive: true });
            const requestType = Array.isArray(req.headers["content-type"])
              ? req.headers["content-type"][0]
              : req.headers["content-type"];
            const mime = requestType?.split(";", 1)[0];
            const file = cacheFileForWrite(name, url.searchParams.get("name") ?? undefined, mime);
            const w = fs.createWriteStream(file);
            req.pipe(w);
            w.on("finish", () => {
              if (!name.endsWith(".meta.json")) {
                const hash = hashFromCacheName(name);
                if (hash) cacheFilesByHash.set(hash, file);
              }
              res.statusCode = 200;
              res.end("ok");
            });
            return;
          }
          if (req.method === "HEAD" || req.method === "GET") {
            const file = cachedFile(name);
            if (!fs.existsSync(file)) {
              res.statusCode = 404;
              return res.end();
            }
            return sendFile(req, res, file);
          }
        }
        if (url.pathname.startsWith("/__out-chunk/") && req.method === "PUT") {
          fs.mkdirSync(outDir, { recursive: true });
          const file = path.join(outDir, path.basename(safe(url.pathname.slice("/__out-chunk/".length))));
          const position = Number(url.searchParams.get("position"));
          if (!Number.isSafeInteger(position) || position < 0) return json(res, 400, { error: "position must be a non-negative integer" });
          const body = await readBody(req);
          let handle: fs.promises.FileHandle | null = null;
          try {
            try {
              handle = await fs.promises.open(file, "r+");
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
              handle = await fs.promises.open(file, "w+");
            }
            await handle.write(body, 0, body.byteLength, position);
            return json(res, 200, { ok: true });
          } finally {
            await handle?.close();
          }
        }
        if (u.startsWith("/__out/") && req.method === "DELETE") {
          const file = path.join(outDir, path.basename(safe(u.slice("/__out/".length))));
          await fs.promises.rm(file, { force: true });
          return json(res, 200, { ok: true });
        }
        if (u.startsWith("/__out/") && req.method === "PUT") {
          fs.mkdirSync(outDir, { recursive: true });
          const file = path.join(outDir, path.basename(safe(u.slice("/__out/".length))));
          const w = fs.createWriteStream(file);
          req.pipe(w);
          w.on("finish", () => {
            res.statusCode = 200;
            res.end("ok");
          });
          return;
        }

        next();
      };

      server.middlewares.use((req, res, next) => {
        handle(req, res, next).catch((e) => json(res, 500, { error: String((e as Error).message) }));
      });
    },
  };
}
