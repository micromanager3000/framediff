// Load + validate framediff.assets.json (the UUID → contentHash → sources map).

import { validateAssetManifest, type AssetManifest } from "../graph/schemas";

export async function loadManifest(src: string | AssetManifest, fetchImpl: typeof fetch = fetch): Promise<AssetManifest> {
  const obj = typeof src === "string" ? await fetchImpl(src).then((r) => r.json()) : src;
  const v = validateAssetManifest(obj);
  if (!v.ok) throw new Error("Invalid asset manifest:\n  " + v.errors.join("\n  "));
  return obj as AssetManifest;
}
