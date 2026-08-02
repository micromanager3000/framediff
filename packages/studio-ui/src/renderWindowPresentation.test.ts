import { describe, expect, it } from "vitest";
import { renderWindowPresentation } from "./renderWindowPresentation";

describe("render window presentation", () => {
  it.each(["queued", "starting", "rendering", "uploading"])(
    "identifies %s as remote cloud work",
    (phase) => {
      expect(renderWindowPresentation(phase)).toEqual({
        label: "CLOUD RENDER MONITOR",
        runningMessage:
          "This job is rendering on AWS. This window only follows server status; closing it will not cancel the cloud render.",
      });
    },
  );

  it("retains the dedicated-window guidance for local frame capture", () => {
    expect(renderWindowPresentation("capture")).toEqual({
      label: "DEDICATED RENDERER",
      runningMessage:
        "Keep this window open. It stays separate so Chrome can keep frame capture active in the background.",
    });
  });
});
