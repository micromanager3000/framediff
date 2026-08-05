import { describe, expect, it, vi } from "vitest";
import { ObservableValue } from "../observable";
import type { ProjectRenderSnapshot, RenderProgressSnapshot, StudioSessionState } from "../types";
import type { StudioSession } from "../StudioSession";
import type { ProjectWorkspacePort } from "../types";
import { RenderManager, type RenderExecutor } from "./RenderManager";

const session = () => ({
  state: new ObservableValue<Pick<StudioSessionState, "currentKey">>({ currentKey: "main" }),
  pause: vi.fn(),
}) as unknown as StudioSession;

const workspace = {
  renderComposition: vi.fn(),
} as unknown as ProjectWorkspacePort;

const renderEntry = (id: string, state: ProjectRenderSnapshot["state"] = "succeeded"): ProjectRenderSnapshot => ({
  schemaVersion: 1,
  id,
  compositionKey: "main",
  state,
  attempt: 1,
  createdAt: "2026-08-04T00:00:00Z",
  updatedAt: "2026-08-04T00:01:00Z",
  source: { revision: "a".repeat(64), bundleIdentity: `blake3:${"a".repeat(64)}` },
  provenance: {
    fingerprint: `sha256:${id}`,
    frameDiffRevision: "revision",
    workerImageDigest: "sha256:worker",
    engineRevision: "engine",
    runtimeIdentity: "runtime",
  },
});

describe("RenderManager", () => {
  it("renders a requested batch sequentially and reports the collected downloads", async () => {
    const studioSession = session();
    const manager = new RenderManager(studioSession, workspace);
    const order: string[] = [];

    const completed = await manager.renderMany(["lighthouse-workflow", "main"], async (key, onProgress) => {
      order.push(key);
      onProgress({ phase: "render", completed: 30, total: 60 });
      return { filename: `${key}.mp4`, bytes: key.length };
    });

    expect(completed).toBe(true);
    expect(order).toEqual(["lighthouse-workflow", "main"]);
    expect(manager.state.get()).toMatchObject({
      status: "done",
      filename: "2 videos",
      filenames: ["lighthouse-workflow.mp4", "main.mp4"],
      bytes: "lighthouse-workflow".length + "main".length,
      batch: { current: 2, total: 2, compositionKey: "main" },
    });
    expect(studioSession.pause).toHaveBeenCalledOnce();
  });

  it("retains completed downloads when a later render fails", async () => {
    const manager = new RenderManager(session(), workspace);

    const completed = await manager.renderMany(["main", "second"], async (key) => {
      if (key === "second") throw new Error("encode failed");
      return { filename: "main.mp4", bytes: 42 };
    });

    expect(completed).toBe(false);
    expect(manager.state.get()).toMatchObject({
      status: "error",
      filenames: ["main.mp4"],
      bytes: 42,
      error: "encode failed",
      batch: { current: 2, total: 2, compositionKey: "second" },
    });
  });

  it("keeps the workspace renderer as the unchanged default executor", async () => {
    const localWorkspace = { renderComposition: vi.fn(async (_key: string, onProgress: (progress: RenderProgressSnapshot) => void) => {
      onProgress({ phase: "render", completed: 1, total: 1 });
      return { filename: "local.mp4", bytes: 7 };
    }) } as unknown as ProjectWorkspacePort;
    const manager = new RenderManager(session(), localWorkspace);

    expect(await manager.renderCurrent()).toBe(true);
    expect(localWorkspace.renderComposition).toHaveBeenCalledWith("main", expect.any(Function));
    expect(manager.state.get()).toMatchObject({ status: "done", filename: "local.mp4" });
  });

  it("only requires a dedicated browser window for local rendering", () => {
    expect(new RenderManager(session(), workspace).requiresDedicatedWindow).toBe(true);
    expect(new RenderManager(session(), {
      ...workspace,
      renderExecutionMode: "remote",
    } as unknown as ProjectWorkspacePort).requiresDedicatedWindow).toBe(false);
  });

  it("cancels a remote job by its progress identity and ignores the stale completion", async () => {
    const manager = new RenderManager(session(), workspace);
    let resolve: ((result: { filename: string; bytes: number }) => void) | undefined;
    const cancel = vi.fn(async () => undefined);
    const executor: RenderExecutor = Object.assign(
      async (_key: string, onProgress: (progress: RenderProgressSnapshot) => void) => {
        onProgress({ phase: "rendering", completed: 1, total: 2, jobId: "remote-job" });
        return new Promise<{ filename: string; bytes: number }>((complete) => { resolve = complete; });
      },
      { cancel },
    );
    const running = manager.renderMany(["main"], executor);
    await Promise.resolve();
    expect(await manager.cancel()).toBe(true);
    expect(cancel).toHaveBeenCalledWith("remote-job");
    expect(manager.state.get().status).toBe("cancelled");
    resolve?.({ filename: "late.mp4", bytes: 1 });
    expect(await running).toBe(false);
    expect(manager.state.get().status).toBe("cancelled");
  });

  it("keeps a remote render active and exposes an error when cancellation rejects", async () => {
    const manager = new RenderManager(session(), workspace);
    const cancel = vi.fn(async () => { throw new Error("cancel conflict"); });
    const executor: RenderExecutor = Object.assign(
      async (_key: string, onProgress: (progress: RenderProgressSnapshot) => void) => {
        onProgress({ phase: "rendering", completed: 1, total: 2, jobId: "remote-job-2" });
        return new Promise<{ filename: string; bytes: number }>(() => undefined);
      },
      { cancel },
    );
    void manager.renderMany(["main"], executor);
    await Promise.resolve();
    expect(await manager.cancel()).toBe(false);
    expect(manager.state.get()).toMatchObject({ status: "rendering", error: "cancel conflict" });
  });

  it("loads durable project renders and ignores a stale overlapping refresh", async () => {
    const completions: Array<(entries: ProjectRenderSnapshot[]) => void> = [];
    const listProjectRenders = vi.fn(() => new Promise<ProjectRenderSnapshot[]>((resolve) => completions.push(resolve)));
    const manager = new RenderManager(session(), {
      ...workspace,
      listProjectRenders,
    } as unknown as ProjectWorkspacePort);

    const first = manager.refreshLibrary();
    const second = manager.refreshLibrary();
    completions[1]([renderEntry("new")]);
    await expect(second).resolves.toBe(true);
    completions[0]([renderEntry("old")]);
    await expect(first).resolves.toBe(false);

    expect(manager.library.get()).toMatchObject({
      available: true,
      loading: false,
      entries: [{ id: "new" }],
      error: null,
    });
  });

  it("restores library action state and exposes an actionable download error", async () => {
    const downloadProjectRender = vi.fn(async () => { throw new Error("signed download expired"); });
    const manager = new RenderManager(session(), {
      ...workspace,
      listProjectRenders: vi.fn(async () => [renderEntry("render-1")]),
      downloadProjectRender,
    } as unknown as ProjectWorkspacePort);
    await manager.refreshLibrary();

    await expect(manager.downloadLibraryEntry("render-1")).resolves.toBe(false);

    expect(downloadProjectRender).toHaveBeenCalledWith("render-1");
    expect(manager.library.get()).toMatchObject({
      action: null,
      error: "signed download expired",
      entries: [{ id: "render-1" }],
    });
  });
});
