import { describe, expect, it } from "vitest";
import { renderProgressPresentation } from "./renderProgressPresentation";

describe("render progress presentation", () => {
  it.each([
    ["queued", "AWS queued…"],
    ["starting", "AWS starting…"],
    ["rendering", "AWS rendering…"],
    ["uploading", "publishing artifact…"],
  ] as const)("presents coarse %s progress as indeterminate", (phase, text) => {
    expect(renderProgressPresentation({ phase, completed: 0, total: 1, message: "provider status" })).toEqual({
      text,
      title: "provider status",
      determinate: false,
    });
  });

  it("shows a percentage when a cloud worker reports measured progress", () => {
    expect(renderProgressPresentation({ phase: "rendering", completed: 450, total: 1800 })).toEqual({
      text: "AWS rendering · 25%",
      determinate: true,
    });
  });

  it("retains percentage progress for local rendering", () => {
    expect(renderProgressPresentation({ phase: "render", completed: 450, total: 1800 })).toEqual({
      text: "render · 25%",
      determinate: true,
    });
  });
});
