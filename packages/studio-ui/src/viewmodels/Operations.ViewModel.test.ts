import { describe, expect, it } from "vitest";
import { cacheEntryMatchesSearch } from "./Operations.ViewModel";

describe("cacheEntryMatchesSearch", () => {
  const entry = {
    name: "sha256:bake",
    filename: "LowerThird-bake--sha256-abc.mp4",
    label: "LowerThird bake",
    compId: "LowerThird",
    contentHash: "sha256:abc",
    size: 1200,
    mtimeMs: 1,
  };

  it("matches human labels, filenames, composition IDs and hashes", () => {
    expect(cacheEntryMatchesSearch(entry, "lowerthird")).toBe(true);
    expect(cacheEntryMatchesSearch(entry, "ABC")).toBe(true);
    expect(cacheEntryMatchesSearch(entry, "missing")).toBe(false);
  });
});
