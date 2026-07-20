import { describe, it, expect } from "vitest";
import { validateAssetManifest, validateLockfile, validateJobRecord } from "./schemas";

describe("validateAssetManifest", () => {
  it("accepts a valid manifest", () => {
    const r = validateAssetManifest({
      version: 1,
      assets: { uuid: { name: "broll/city.mp4", contentHash: "sha256:x", mime: "video/mp4", bytes: 1, sources: ["s3://b/x"], proxy: "sha256:p", durationSeconds: 3.25 } },
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("rejects invalid optional media duration metadata", () => {
    const r = validateAssetManifest({
      version: 1,
      assets: { uuid: { name: "clip.mp4", contentHash: "sha256:x", mime: "video/mp4", bytes: 1, sources: [], durationSeconds: -1 } },
    });
    expect(r.errors).toContain("assets[uuid].durationSeconds must be a non-negative number if present");
  });
  it("reports each malformed field", () => {
    const r = validateAssetManifest({ version: 2, assets: { uuid: { name: 1, mime: "x", bytes: "no", sources: "no" } } });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(4); // version + name + bytes + sources (contentHash missing too)
  });
});

describe("validateLockfile", () => {
  it("accepts a valid lock and checks the target shape", () => {
    const ok = validateLockfile({ version: 1, artifacts: { fp: { kind: "precomp", contentHash: "sha256:x", bytes: 1, target: { w: 1, h: 1, fps: 1 } } } });
    expect(ok.ok).toBe(true);
    const bad = validateLockfile({ version: 1, artifacts: { fp: { kind: "precomp", contentHash: "sha256:x", bytes: 1, target: { w: 1 } } } });
    expect(bad.ok).toBe(false);
  });
});

describe("validateJobRecord", () => {
  it("accepts a valid record", () => {
    expect(
      validateJobRecord({
        version: 1, fingerprint: "f", kind: "video-to-video", provider: "seedance", endpoint: "e",
        requestHash: "r", idempotencyKey: "k", inputContentHashes: ["a"], status: "submitted",
        submittedAt: "t", updatedAt: "t", resultContentHash: null,
      }).ok,
    ).toBe(true);
  });
  it("rejects a bad status enum and a non-null/non-string result", () => {
    const r = validateJobRecord({ version: 1, fingerprint: "f", provider: "p", idempotencyKey: "k", inputContentHashes: [], status: "bogus", resultContentHash: 5 });
    expect(r.ok).toBe(false);
  });
});
