import { describe, expect, it } from "vitest";
import {
  RENDER_WINDOW_QUERY_PARAM,
  buildRenderWindowUrl,
  isRenderWindowMessage,
  renderWindowToken,
} from "./renderWindow";

describe("dedicated render window protocol", () => {
  it("targets the selected composition while preserving project query parameters", () => {
    const href = buildRenderWindowUrl("http://localhost:5173/studio?theme=dark&comp=old", "hero/main", "token-1");
    const url = new URL(href);
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("comp")).toBe("hero/main");
    expect(url.searchParams.get(RENDER_WINDOW_QUERY_PARAM)).toBe("token-1");
    expect(renderWindowToken(href)).toBe("token-1");
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
