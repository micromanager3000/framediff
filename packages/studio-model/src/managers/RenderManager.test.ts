import { describe, expect, it, vi } from "vitest";
import { ObservableValue } from "../observable";
import type { RenderProgressSnapshot, StudioSessionState } from "../types";
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
});
