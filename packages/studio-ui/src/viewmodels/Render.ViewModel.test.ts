import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObservableValue, type RenderManager, type StudioSession } from "@framediff/studio-model";
import { openRenderWindow, runInRenderWindow } from "../renderWindow";
import { RenderViewModel } from "./Render.ViewModel";

vi.mock("../renderWindow", () => ({
  openRenderWindow: vi.fn(),
  renderWindowRequest: vi.fn(() => null),
  runInRenderWindow: vi.fn(),
}));

function manager(requiresDedicatedWindow: boolean) {
  return {
    requiresDedicatedWindow,
    state: new ObservableValue({ status: "idle" }),
    library: new ObservableValue({ available: false, loading: false, entries: [], error: null, action: null }),
    renderMany: vi.fn(async () => true),
    refreshLibrary: vi.fn(async () => true),
    downloadLibraryEntry: vi.fn(async () => true),
    retryLibraryEntry: vi.fn(async () => true),
    cancelLibraryEntry: vi.fn(async () => true),
  } as unknown as RenderManager;
}

const session = {
  state: new ObservableValue({ currentKey: "main" }),
} as unknown as StudioSession;

describe("RenderViewModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { name: "" });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("submits remote renders in the Studio tab without opening a popup", async () => {
    const render = manager(false);

    await expect(new RenderViewModel(render, session).renderCurrentComposition()).resolves.toBe(true);

    expect(openRenderWindow).not.toHaveBeenCalled();
    expect(render.renderMany).toHaveBeenCalledWith(["main"]);
  });

  it("keeps the dedicated popup executor for local browser rendering", async () => {
    const handle = { popup: { close: vi.fn() } };
    vi.mocked(openRenderWindow).mockReturnValue(handle as never);
    vi.mocked(runInRenderWindow).mockResolvedValue({ filename: "main.webm", bytes: 12 });
    const render = manager(true);

    await expect(new RenderViewModel(render, session).renderCurrentComposition()).resolves.toBe(true);

    expect(openRenderWindow).toHaveBeenCalledWith("main");
    expect(render.renderMany).toHaveBeenCalledWith(["main"], expect.any(Function));
  });

  it("delegates render-library actions and exports the durable manifest", async () => {
    const render = manager(false);
    const entry = {
      schemaVersion: 1 as const,
      id: "render-1",
      compositionKey: "main",
      state: "succeeded" as const,
      attempt: 1,
      createdAt: "2026-08-04T00:00:00Z",
      updatedAt: "2026-08-04T00:01:00Z",
      source: { revision: "revision", bundleIdentity: "bundle" },
      provenance: {
        fingerprint: "fingerprint",
        frameDiffRevision: "framediff",
        workerImageDigest: "worker",
        engineRevision: "engine",
        runtimeIdentity: "runtime",
      },
    };
    render.library.set({ available: true, loading: false, entries: [entry], error: null, action: null });
    const viewModel = new RenderViewModel(render, session);

    await expect(viewModel.download("render-1")).resolves.toBe(true);
    await expect(viewModel.retry("render-1")).resolves.toBe(true);
    await expect(viewModel.cancel("render-1")).resolves.toBe(true);

    expect(render.downloadLibraryEntry).toHaveBeenCalledWith("render-1");
    expect(render.retryLibraryEntry).toHaveBeenCalledWith("render-1");
    expect(render.cancelLibraryEntry).toHaveBeenCalledWith("render-1");
    expect(viewModel.manifest("render-1")).toEqual(entry);
  });
});
