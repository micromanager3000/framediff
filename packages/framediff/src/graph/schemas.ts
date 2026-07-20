// On-disk contracts: framediff.assets.json (source media by UUID), framediff.lock (fingerprint → pinned
// content hash; resolution metadata only), and the durable generator job record. Each has a structural
// validator that returns actionable errors rather than throwing deep in a render.

import type { Hash } from "./hash";

// ---- framediff.assets.json ----
export interface AssetEntry {
  name: string; // human label, not used for resolution
  contentHash: Hash;
  mime: string;
  bytes: number;
  sources: string[]; // tried in order: cas:// , s3:// , https:// …
  proxy?: Hash; // optional low-res proxy
  aliases?: string[]; // alternate names this content was imported under
  derivedFrom?: string; // parent asset id this entry was derived from (proxy/remux provenance)
  durationSeconds?: number; // optional probed media duration used for source-limit editing
}
export interface AssetManifest {
  version: 1;
  assets: Record<string, AssetEntry>; // keyed by UUID
}

// ---- framediff.lock ----
export interface LockEntry {
  kind: string;
  contentHash: Hash;
  bytes: number;
  target?: { w: number; h: number; fps: number };
  remote?: string;
  createdAt?: string;
  note?: string;
}
export interface Lockfile {
  version: 1;
  artifacts: Record<string, LockEntry>; // keyed by fingerprint
}

// ---- durable generator job record ----
export type JobStatus = "submitted" | "running" | "succeeded" | "failed";
export interface JobRecord {
  version: 1;
  fingerprint: Hash;
  kind: string;
  provider: string;
  endpoint: string;
  requestHash: Hash;
  idempotencyKey: string;
  providerJobId?: string;
  inputContentHashes: Hash[];
  status: JobStatus;
  submittedAt: string;
  updatedAt: string;
  resultContentHash: Hash | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ---- tiny structural-check helpers ----
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function check(errors: string[], cond: boolean, msg: string) {
  if (!cond) errors.push(msg);
}

export function validateAssetManifest(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ["manifest: not an object"] };
  check(errors, v.version === 1, "manifest: version must be 1");
  if (!isObj(v.assets)) {
    errors.push("manifest: missing assets map");
  } else {
    for (const [id, e] of Object.entries(v.assets)) {
      const at = `assets[${id}]`;
      if (!isObj(e)) {
        errors.push(`${at}: not an object`);
        continue;
      }
      check(errors, isStr(e.name), `${at}.name must be a string`);
      check(errors, isStr(e.contentHash), `${at}.contentHash must be a string`);
      check(errors, isStr(e.mime), `${at}.mime must be a string`);
      check(errors, isNum(e.bytes), `${at}.bytes must be a number`);
      check(errors, Array.isArray(e.sources) && e.sources.every(isStr), `${at}.sources must be a string[]`);
      check(errors, e.proxy === undefined || isStr(e.proxy), `${at}.proxy must be a string if present`);
      const durationSeconds = e.durationSeconds;
      check(errors, durationSeconds === undefined || (isNum(durationSeconds) && durationSeconds >= 0), `${at}.durationSeconds must be a non-negative number if present`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateLockfile(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ["lock: not an object"] };
  check(errors, v.version === 1, "lock: version must be 1");
  if (!isObj(v.artifacts)) {
    errors.push("lock: missing artifacts map");
  } else {
    for (const [fp, e] of Object.entries(v.artifacts)) {
      const at = `artifacts[${fp}]`;
      if (!isObj(e)) {
        errors.push(`${at}: not an object`);
        continue;
      }
      check(errors, isStr(e.kind), `${at}.kind must be a string`);
      check(errors, isStr(e.contentHash), `${at}.contentHash must be a string`);
      check(errors, isNum(e.bytes), `${at}.bytes must be a number`);
      if (e.target !== undefined) {
        const t = e.target;
        check(errors, isObj(t) && isNum(t.w) && isNum(t.h) && isNum(t.fps), `${at}.target must be {w,h,fps}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

const JOB_STATUSES: JobStatus[] = ["submitted", "running", "succeeded", "failed"];

export function validateJobRecord(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ["job: not an object"] };
  check(errors, v.version === 1, "job: version must be 1");
  check(errors, isStr(v.fingerprint), "job.fingerprint must be a string");
  check(errors, isStr(v.provider), "job.provider must be a string");
  check(errors, isStr(v.idempotencyKey), "job.idempotencyKey must be a string");
  check(errors, Array.isArray(v.inputContentHashes) && v.inputContentHashes.every(isStr), "job.inputContentHashes must be a string[]");
  check(errors, isStr(v.status) && JOB_STATUSES.includes(v.status as JobStatus), `job.status must be one of ${JOB_STATUSES.join("|")}`);
  check(errors, v.resultContentHash === null || isStr(v.resultContentHash), "job.resultContentHash must be a string or null");
  return { ok: errors.length === 0, errors };
}
