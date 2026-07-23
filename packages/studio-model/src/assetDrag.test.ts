import { describe, expect, it } from "vitest";
import { parseFramediffAssetDragPayload } from "./assetDrag";

describe("parseFramediffAssetDragPayload", () => {
  it("accepts the portable identity needed to place a direct asset reference", () => {
    expect(parseFramediffAssetDragPayload(JSON.stringify({
      id: "asset-123",
      name: "storm-reference.png",
      mime: "image/png",
    }))).toEqual({
      id: "asset-123",
      name: "storm-reference.png",
      mime: "image/png",
    });
  });

  it("rejects malformed or incomplete drag data", () => {
    expect(parseFramediffAssetDragPayload("{bad json")).toBeNull();
    expect(parseFramediffAssetDragPayload(JSON.stringify({ id: "asset-123" }))).toBeNull();
  });
});
