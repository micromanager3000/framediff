// Precomp baker + the resolve orchestrator. A precomp bakes by recursively rendering a sub-composition
// (default: exportVideo) to an MP4 at the destination resolution, hashing it, storing it in the CAS,
// and returning a MediaBundle. Keyed by fingerprint through the P2 scheduler, an unchanged precomp is
// a pure cache hit. The recursive render is injected so the orchestrator is unit-testable in Node.

import type { CompositionConfig } from "../composition";
import { plan, type CompositionDef, type PlanNode } from "../graph/planner";
import { resolveGraph, type Baker, type ResolvedNode } from "../graph/scheduler";
import type { Toolchain } from "../graph/fingerprint";
import type { Hash } from "../graph/hash";
import { hashBlob } from "../graph/hash";
import type { CAS } from "../assets/cas";
import type { AssetResolver } from "../assets/resolver";
import { resolveBakeResolution, type BakeResolution, type MediaBundle } from "./mediaBundle";

export interface PrecompBakerDeps {
  /** recursive bake — returns the MP4 bytes for a composition at a resolution (default: exportVideo). */
  exportComposition: (comp: CompositionConfig, opts: { width: number; height: number }) => Promise<ArrayBuffer>;
  cas: CAS;
  /** sub-compositions referenced by precomp nodes (params.composition). */
  compositions: Record<string, CompositionConfig>;
  /** the final render target (for "auto"/"target" bake resolution). */
  target: { w: number; h: number };
  makeObjectURL?: (b: Blob) => string;
}

export function createPrecompBaker(deps: PrecompBakerDeps): Baker {
  const makeURL = deps.makeObjectURL ?? ((b: Blob) => (typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(b) : ""));
  return async (node) => {
    const compId = String(node.params.composition ?? node.id);
    const comp = deps.compositions[compId];
    if (!comp) throw new Error(`precomp "${node.id}": unknown composition "${compId}"`);
    const res = resolveBakeResolution(node.params.bakeResolution as BakeResolution | undefined, { w: comp.width, h: comp.height }, deps.target);
    const mp4 = await deps.exportComposition(comp, { width: res.w, height: res.h });
    const blob = new Blob([mp4], { type: "video/mp4" });
    const contentHash = await hashBlob(blob);
    await deps.cas.put(contentHash, blob);
    const bundle: MediaBundle = {
      video: { contentHash, url: makeURL(blob), codec: "avc", width: res.w, height: res.h, fps: comp.fps },
      audioStems: [], // video-only for now; <Comp> re-emits stems as <Audio> when present
      durationInFrames: comp.durationInFrames,
      color: { workingSpace: "srgb", transfer: "srgb", range: "full" },
    };
    return { contentHash, value: bundle };
  };
}

/** Resolve a source asset to its content hash (so downstream nodes bind to bytes). */
export function createAssetBaker(resolver: AssetResolver): Baker {
  return async (node) => {
    const id = String(node.params.assetId ?? node.id);
    const resolved = await resolver.resolve(id.startsWith("asset://") ? id : `asset://${id}`);
    if (!resolved.contentHash) throw new Error(`asset "${id}" resolved without a content hash`);
    return { contentHash: resolved.contentHash, value: { url: resolved.url, mime: resolved.mime } };
  };
}

// Placeholder toolchain. Real cross-runner codeHash + resolved dep versions are P0 risk #1 — deferred.
const defaultToolchain = (_node: PlanNode): Toolchain => ({ recipeVersion: "1", codeHash: "sha256:framediff-dev", deps: {} });

export interface ResolveCompositionOptions {
  target: { w: number; h: number };
  bakers: Record<string, Baker>;
  toolchain?: (node: PlanNode) => Toolchain;
  cache?: { get(fp: Hash): ResolvedNode | undefined; set(fp: Hash, r: ResolvedNode): void };
}

/** Plan a composition's build graph and resolve it (bake precomps/assets bottom-up). Returns the
 *  named output artifacts (from build()'s return) resolved to their bundles/values. */
export async function resolveComposition(def: CompositionDef, opts: ResolveCompositionOptions): Promise<Record<string, ResolvedNode>> {
  const p = plan(def);
  const resolved = await resolveGraph(p.nodes, {
    bakers: opts.bakers,
    toolchain: opts.toolchain ?? defaultToolchain,
    // the render target only changes the bytes of resolution-sensitive nodes (precomp/render3d/bake3d)
    targetKey: (n) => (n.kind === "precomp" || n.kind === "render3d" || n.kind === "bake3d" ? opts.target : null),
    cache: opts.cache,
  });
  const out: Record<string, ResolvedNode> = {};
  for (const [name, art] of Object.entries(p.outputs)) {
    const r = resolved.get(art.nodeId);
    if (r) out[name] = r;
  }
  return out;
}
