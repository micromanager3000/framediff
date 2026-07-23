// Browser client for the dev bridge (framediff/vite plugin). Dev-only: every call degrades
// gracefully (nulls / empty lists) when the endpoints aren't there, so the Studio still
// works as a pure preview against any static server.

import type { CacheEntry } from "./types";
import type { GenInputProvenance, GenRecipeSnapshot, GenRefKind } from "../generative";
import type {
  ProjectEditConflict,
  ProjectEditReceipt,
  SourceFileRevisionSnapshot,
} from "@framediff/studio-model";

export interface SourceEditFileRequest {
  file: string;
  expectedHash: string | null;
  text: string | null;
}

export interface SourceEditRequest {
  label: string;
  groupId?: string;
  files: SourceEditFileRequest[];
}

export interface SourceEditResponse {
  ok: boolean;
  receipt?: ProjectEditReceipt;
  conflicts?: ProjectEditConflict[];
  error?: string;
}

export async function readSourceRevision(file: string): Promise<SourceFileRevisionSnapshot | null> {
  try {
    const r = await fetch(`/__framediff/src?file=${encodeURIComponent(file)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { file: string; text: string; hash: string };
    return { file: j.file, text: j.text, hash: j.hash };
  } catch {
    return null;
  }
}

export async function readSource(file: string): Promise<string | null> {
  return (await readSourceRevision(file))?.text ?? null;
}

/** Atomic, revision-checked source transaction used by Studio, undo/redo, and agents. */
export async function applySourceEdit(request: SourceEditRequest): Promise<SourceEditResponse> {
  try {
    const r = await fetch("/__framediff/edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const j = (await r.json()) as SourceEditResponse;
    return r.ok && j.ok ? j : { ...j, ok: false, error: j.error ?? `Source edit failed (${r.status}).` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function writeSource(file: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(`/__framediff/src?file=${encodeURIComponent(file)}`, {
      method: "PUT",
      body: text,
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteSource(file: string): Promise<boolean> {
  try {
    const r = await fetch(`/__framediff/src?file=${encodeURIComponent(file)}`, { method: "DELETE" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function listCache(): Promise<CacheEntry[]> {
  try {
    const r = await fetch("/__framediff/cache");
    if (!r.ok) return [];
    const j = (await r.json()) as { entries: CacheEntry[] };
    return j.entries;
  } catch {
    return [];
  }
}

export async function gitDirty(): Promise<string[] | null> {
  try {
    const r = await fetch("/__framediff/git");
    if (!r.ok) return null;
    const j = (await r.json()) as { dirty: string[] };
    return j.dirty;
  } catch {
    return null;
  }
}

export async function gitCommit(message: string): Promise<string | null> {
  try {
    const r = await fetch("/__framediff/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { hash: string };
    return j.hash;
  } catch {
    return null;
  }
}

/** Persist a sidecar next to a baked artifact (through the CAS folder endpoint). */
export async function writeArtifactMeta(name: string, meta: unknown): Promise<void> {
  try {
    await fetch(`/__framediff-cache/${encodeURIComponent(name)}.meta.json`, {
      method: "PUT",
      body: JSON.stringify(meta, null, 2),
    });
  } catch {
    /* dev-only */
  }
}

// ---- assets (framediff.assets.json + cache ingest) ----

export interface AssetManifestJson {
  version: 1;
  assets: Record<
    string,
    {
      name: string;
      contentHash: string;
      mime: string;
      bytes: number;
      sources: string[];
      /** Alternate human names this content was imported under. */
      aliases?: string[];
      /** Optional content hash of a browser-compatible preview rendition. */
      proxy?: string;
      /** Parent asset id this entry was derived from (a proxy or remux) —
       *  the Media rail folds it under that parent as a rendition. */
      derivedFrom?: string;
      /** Optional probed duration used by source-true timeline trims. */
      durationSeconds?: number;
    }
  >;
}

export async function getAssets(): Promise<AssetManifestJson | null> {
  try {
    const r = await fetch("/__framediff/assets", { cache: "no-store" });
    return r.ok ? ((await r.json()) as AssetManifestJson) : null;
  } catch {
    return null;
  }
}

/** Upload a browser File into the cache + manifest; returns the asset id. */
export async function uploadAsset(file: File): Promise<string | null> {
  try {
    const r = await fetch(`/__framediff/assets/upload?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      body: file,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { id: string };
    return j.id;
  } catch {
    return null;
  }
}

/** Ingest a file already on the machine (absolute or ~ path) into the cache + manifest. */
export async function ingestAssetPath(p: string, name?: string): Promise<string | null> {
  try {
    const r = await fetch("/__framediff/assets/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: p, name }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { id: string };
    return j.id;
  } catch {
    return null;
  }
}

// ---- generative comps (provider secrets + the fal proxy) ----

export interface SecretsInfo {
  providers: Record<string, { set: boolean; last4?: string; source?: "file" | "env" }>;
  /** Where keys land at the project repository root (gitignored). */
  file?: string;
}

export async function getSecrets(): Promise<SecretsInfo | null> {
  try {
    const r = await fetch("/__framediff/secrets");
    return r.ok ? ((await r.json()) as SecretsInfo) : null;
  } catch {
    return null;
  }
}

export async function putSecret(provider: string, key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/__framediff/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, key }),
    });
    const j = (await r.json()) as { ok?: boolean; error?: string };
    return { ok: !!j.ok, error: j.error };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

export async function deleteSecret(provider: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/__framediff/secrets", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const j = (await r.json()) as { ok?: boolean; error?: string };
    return { ok: !!j.ok, error: j.error };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

export interface VerifyResult {
  ok: boolean;
  authed?: boolean;
  error?: string;
  note?: string;
}

export async function verifyProvider(provider: string): Promise<VerifyResult> {
  try {
    const r = await fetch(`/__framediff/gen/verify?provider=${encodeURIComponent(provider)}`);
    return (await r.json()) as VerifyResult;
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

export interface GenJob {
  id: string;
  providerJobId?: string;
  gen: string;
  endpoint: string;
  recipeHash: string;
  status: "queued" | "running" | "done" | "failed";
  error?: string;
  take?: number;
  assetId?: string;
  seed?: number;
  at: string;
  doneAt?: string;
  recipe?: GenRecipeSnapshot;
  inputs?: GenInputProvenance[];
}

/** Jobs are append-only in the repo-tracked framediff.generations.json ledger. A failure
 *  remains useful history, but it is only the current error when no newer attempt has
 *  superseded it. */
export function latestFailedGenJob(jobs: readonly GenJob[]): GenJob | null {
  const latest = jobs[jobs.length - 1];
  return latest?.status === "failed" ? latest : null;
}

export interface GenTakeRow {
  assetId: string;
  contentHash: string;
  bytes: number;
  mime?: string;
  generator: {
    gen: string;
    take: number;
    recipeHash: string;
    endpoint: string;
    recipe: GenRecipeSnapshot;
    inputs: GenInputProvenance[];
    requestId?: string;
    seed?: number;
    outputKind?: "video" | "image" | "audio";
    at?: string;
  };
}

export async function genSubmit(payload: {
  gen: string;
  endpoint: string;
  recipeHash: string;
  input: Record<string, unknown>;
  refs: { kind: GenRefKind; src: string; authoredSrc: string; mime?: string; name?: string; field?: string; many?: boolean }[];
  recipe: GenRecipeSnapshot;
}): Promise<{ job?: GenJob; error?: string }> {
  try {
    const r = await fetch("/__framediff/gen/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await r.json()) as { job?: GenJob; error?: string };
  } catch (e) {
    return { error: String((e as Error).message) };
  }
}

export async function genJobs(gen: string): Promise<{ jobs: GenJob[]; takes: GenTakeRow[] } | null> {
  try {
    const r = await fetch(`/__framediff/gen/jobs?gen=${encodeURIComponent(gen)}`);
    return r.ok ? ((await r.json()) as { jobs: GenJob[]; takes: GenTakeRow[] }) : null;
  } catch {
    return null;
  }
}
