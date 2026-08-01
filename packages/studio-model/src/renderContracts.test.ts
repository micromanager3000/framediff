import { describe, expect, it, vi } from "vitest";
import {
  executeRemoteRender,
  fingerprintRenderRequest,
  RemoteRenderError,
  resumeRemoteRender,
  sanitizeRenderError,
  type RemoteRenderBackend,
  type RenderRequest,
} from "./renderContracts";

const request = (): RenderRequest => ({
  version: 1,
  projectId: "project-a",
  compositionKey: "main",
  source: { revision: "commit-a", bundleIdentity: "sha256:bundle-a", files: { "src/main.html": "sha256:source" } },
  assets: [
    { id: "asset-b", contentHash: "sha256:asset-b", mime: "image/png", bytes: 24 },
    { id: "asset-a", contentHash: "sha256:asset", mime: "image/png", bytes: 12 },
  ],
  settings: {
    width: 1920,
    height: 1080,
    fps: { numerator: 30000, denominator: 1001 },
    from: 0,
    to: 30,
    outputKind: "video",
    codec: "avc1.640028",
    bitrate: 8_000_000,
    colorProfile: "bt709",
  },
  frameDiffRevision: "framediff-1",
  workerImageDigest: "sha256:image-1",
  engineRevision: "engine-1",
  runtimeIdentity: "chrome-1",
  fontIdentity: "sha256:fonts-a",
});

describe("remote render contracts", () => {
  it("fingerprints immutable source/assets and render identity deterministically", async () => {
    const a = request();
    const b = { ...request(), assets: [...request().assets].reverse(), settings: { ...request().settings, options: { quality: "high" } } };
    expect(await fingerprintRenderRequest(a)).not.toBe(await fingerprintRenderRequest(b));
    expect(await fingerprintRenderRequest(a)).toBe(await fingerprintRenderRequest({ ...a, assets: [...a.assets].reverse() }));
    expect(await fingerprintRenderRequest(a)).toBe(await fingerprintRenderRequest({ ...a, settings: { ...a.settings, fps: { numerator: 60000, denominator: 2002 } } }));
  });

  it.each([
    ["rational FPS", (value: RenderRequest) => ({ ...value, settings: { ...value.settings, fps: { numerator: 24, denominator: 1 } } })],
    ["codec", (value: RenderRequest) => ({ ...value, settings: { ...value.settings, codec: "vp09" } })],
    ["bitrate", (value: RenderRequest) => ({ ...value, settings: { ...value.settings, bitrate: 12_000_000 } })],
    ["color profile", (value: RenderRequest) => ({ ...value, settings: { ...value.settings, colorProfile: "display-p3" } })],
    ["immutable bundle identity", (value: RenderRequest) => ({ ...value, source: { ...value.source, bundleIdentity: "sha256:bundle-b" } })],
    ["font identity", (value: RenderRequest) => ({ ...value, fontIdentity: "sha256:fonts-b" })],
  ] as const)("changes the fingerprint when %s changes", async (_field, change) => {
    expect(await fingerprintRenderRequest(change(request()))).not.toBe(await fingerprintRenderRequest(request()));
  });

  it("submits once, reports durable phases, and returns CAS metadata", async () => {
    const statuses = [
      { jobId: "job-1", state: "queued" as const },
      { jobId: "job-1", state: "rendering" as const, progress: { phase: "rendering" as const, completed: 2, total: 4 } },
      {
        jobId: "job-1",
        state: "succeeded" as const,
        result: {
          bytes: 42,
          filename: "main.mp4",
          metadata: {
            artifact: { contentHash: "blake3:result", filename: "main.mp4", mime: "video/mp4", bytes: 42 },
            provenance: {
              fingerprint: "sha256:render", projectId: "project-a", compositionKey: "main", sourceRevision: "commit-a", bundleIdentity: "sha256:bundle-a",
              assetHashes: ["sha256:asset-b", "sha256:asset"], settings: request().settings, frameDiffRevision: "framediff-1",
              workerImageDigest: "sha256:image-1", engineRevision: "engine-1", runtimeIdentity: "chrome-1", fontIdentity: "sha256:fonts-a",
            },
          },
        },
      },
    ];
    const backend: RemoteRenderBackend = {
      submit: vi.fn(async () => ({ jobId: "job-1", state: "queued" as const })),
      getStatus: vi.fn(async () => statuses.shift()!),
      cancel: vi.fn(async () => undefined),
    };
    const progress: string[] = [];
    const result = await executeRemoteRender(backend, request(), (event) => progress.push(`${event.jobId}:${event.phase}`), { pollIntervalMs: 0 });
    expect(backend.submit).toHaveBeenCalledOnce();
    expect(backend.getStatus).toHaveBeenCalledTimes(3);
    expect(progress).toEqual(["job-1:queued", "job-1:queued", "job-1:rendering", "job-1:rendering"]);
    expect(result.metadata?.artifact.contentHash).toBe("blake3:result");
  });

  it("cancels an active job when its abort signal fires", async () => {
    const controller = new AbortController();
    const backend: RemoteRenderBackend = {
      submit: vi.fn(async () => ({ jobId: "job-2", state: "starting" as const })),
      getStatus: vi.fn(async () => {
        controller.abort();
        return { jobId: "job-2", state: "rendering" as const };
      }),
      cancel: vi.fn(async () => undefined),
    };
    await expect(executeRemoteRender(backend, request(), () => undefined, { signal: controller.signal, pollIntervalMs: 0 })).rejects.toMatchObject({ code: "cancelled", jobId: "job-2" });
    expect(backend.cancel).toHaveBeenCalledWith("job-2");
  });

  it("can resume an existing job and redacts credential-shaped failures", async () => {
    const backend: RemoteRenderBackend = {
      submit: vi.fn(),
      getStatus: vi.fn(async () => ({ jobId: "job-3", state: "failed" as const, error: { code: "worker", message: "Authorization: abc123" } })),
      cancel: vi.fn(),
    };
    await expect(resumeRemoteRender(backend, "job-3", () => undefined, { pollIntervalMs: 0 })).rejects.toBeInstanceOf(RemoteRenderError);
    expect(sanitizeRenderError(new Error("Authorization: Bearer secret-token")).message).toBe("Authorization: Bearer [redacted]");
  });

  it("rejects stale status identities and does not publish their progress", async () => {
    const backend: RemoteRenderBackend = {
      submit: vi.fn(async () => ({ jobId: "job-4", state: "queued" as const })),
      getStatus: vi.fn(async () => ({ jobId: "job-old", state: "rendering" as const, progress: { phase: "rendering" as const, completed: 1, total: 2 } })),
      cancel: vi.fn(),
    };
    const progress = vi.fn();
    await expect(executeRemoteRender(backend, request(), progress, { pollIntervalMs: 0 })).rejects.toMatchObject({ code: "stale-status", jobId: "job-4" });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-4", phase: "queued" }));
    expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-old" }));
  });

  it("does not regress progress when an older phase arrives late", async () => {
    const statuses = [
      { jobId: "job-5", state: "rendering" as const },
      { jobId: "job-5", state: "queued" as const },
      { jobId: "job-5", state: "succeeded" as const, result: { bytes: 1, filename: "out.mp4" } },
    ];
    const backend: RemoteRenderBackend = {
      submit: vi.fn(async () => ({ jobId: "job-5", state: "queued" as const })),
      getStatus: vi.fn(async () => statuses.shift()!),
      cancel: vi.fn(),
    };
    const progress: string[] = [];
    await executeRemoteRender(backend, request(), (event) => progress.push(event.phase), { pollIntervalMs: 0 });
    expect(progress).toEqual(["queued", "rendering", "rendering"]);
  });
});
