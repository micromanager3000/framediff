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
    renderMany: vi.fn(async () => true),
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
});
