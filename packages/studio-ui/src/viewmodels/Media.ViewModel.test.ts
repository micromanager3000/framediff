import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { ObservableValue, type AssetManager, type AssetState } from "@framediff/studio-model";
import { assetMatchesFilter, MediaViewModel } from "./Media.ViewModel";

const assets: AssetState["assets"] = [
  {
    id: "asset-one",
    name: "clip.mp4",
    mime: "video/mp4",
    bytes: 1024,
    contentHash: "sha256:one",
  },
  {
    id: "asset-two",
    name: "still.png",
    mime: "image/png",
    bytes: 2048,
    contentHash: "sha256:two",
  },
];

function manager() {
  return {
    state: new ObservableValue<AssetState>({ assets, loading: false, uploading: false, error: null }),
    refresh: vi.fn(async () => {}),
    upload: vi.fn(async () => {}),
  } as unknown as AssetManager;
}

describe("MediaViewModel", () => {
  it("filters large media bins by type and portable identity", () => {
    expect(assetMatchesFilter(assets[0], "clip", "video")).toBe(true);
    expect(assetMatchesFilter(assets[0], "asset-one", "all")).toBe(true);
    expect(assetMatchesFilter(assets[0], "SHA256:ONE", "all")).toBe(true);
    expect(assetMatchesFilter(assets[0], "clip", "image")).toBe(false);
    expect(assetMatchesFilter(assets[1], "png", "image")).toBe(true);
  });

  it("selects and clears an asset for the inspector", () => {
    const viewModel = new MediaViewModel(manager());

    expect(get(viewModel.store).selected).toBeUndefined();
    viewModel.select("asset-two");
    expect(get(viewModel.store).selected).toEqual(assets[1]);
    viewModel.clearSelection();
    expect(get(viewModel.store).selected).toBeUndefined();
  });
});
