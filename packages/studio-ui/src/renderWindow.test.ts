import { describe, expect, it } from "vitest";
import {
  buildRenderWindowName,
  buildRenderWindowUrl,
  isRenderWindowMessage,
  renderWindowRequest,
} from "./renderWindow";

describe("dedicated render window protocol", () => {
  it("targets the selected composition without putting composition state in the URL", () => {
    const href = buildRenderWindowUrl("http://localhost:5173/studio?theme=dark&comp=old&framediff-render-window=old");
    const url = new URL(href);
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.has("comp")).toBe(false);
    expect(url.searchParams.has("framediff-render-window")).toBe(false);
    expect(renderWindowRequest(buildRenderWindowName("hero/main", "token-1"))).toEqual({
      compositionKey: "hero/main",
      token: "token-1",
    });
    expect(renderWindowRequest("unrelated-window")).toBeNull();
    expect(renderWindowRequest("framediff-render:not-json")).toBeNull();
  });

  it("accepts only complete progress, result, and error messages", () => {
    expect(isRenderWindowMessage({
      type: "framediff:render-window",
      token: "token-1",
      status: "rendering",
      progress: { phase: "render", completed: 4, total: 10 },
    })).toBe(true);
    expect(isRenderWindowMessage({
      type: "framediff:render-window",
      token: "token-1",
      status: "done",
      result: { bytes: 42, filename: "hero.mp4" },
    })).toBe(true);
    expect(isRenderWindowMessage({
      type: "framediff:render-window",
      token: "token-1",
      status: "error",
      error: "encoder failed",
    })).toBe(true);
    expect(isRenderWindowMessage({ type: "framediff:render-window", token: "token-1", status: "done" })).toBe(false);
    expect(isRenderWindowMessage({ type: "untrusted", token: "token-1", status: "error", error: "no" })).toBe(false);
  });
});
