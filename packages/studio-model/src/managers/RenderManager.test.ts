import { describe, expect, it, vi } from "vitest";
import { ObservableValue } from "../observable";
import type { StudioSessionState } from "../types";
import type { StudioSession } from "../StudioSession";
import type { ProjectWorkspacePort } from "../types";
import { RenderManager } from "./RenderManager";

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
});
