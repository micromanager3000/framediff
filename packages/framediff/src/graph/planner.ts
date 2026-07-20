// The explicit build graph: a composition declares its async/expensive inputs in build(ctx) BEFORE
// any frame renders. Each ctx call registers a node and returns an opaque Artifact handle; passing a
// handle into another node's opts becomes a dependency edge. Bake nodes can ONLY be created during
// the planning pass — creating one from a per-frame render throws (the runtime guard).

import type { CompositionConfig } from "../composition";

/** Opaque handle to a build-graph node's output. */
export class Artifact {
  constructor(
    readonly nodeId: string,
    readonly kind: string,
  ) {}
}
const isArtifact = (v: unknown): v is Artifact => v instanceof Artifact;

export interface PlanNode {
  id: string;
  kind: string; // "asset" | "precomp" | "render3d" | "generate" | "bake3d"
  params: Record<string, unknown>;
  inputs: { role: string; nodeId: string }[];
}

export interface BuildContext {
  /** reference a source asset by manifest id (idempotent — same id ⇒ same node). */
  asset(assetId: string): Artifact;
  /** bake a sub-composition to a clip. */
  precomp(id: string, opts?: Record<string, unknown>): Artifact;
  /** render a glTF model + animation to a clip (@framediff/three). */
  render3d(id: string, opts?: Record<string, unknown>): Artifact;
  /** call an external generation API (@framediff/generate). */
  generate(id: string, opts?: Record<string, unknown>): Artifact;
  /** bake a 3D scene (video-plane etc.) to a clip. */
  bake3d(id: string, opts?: Record<string, unknown>): Artifact;
}

export interface CompositionDef extends CompositionConfig {
  /** declare the build graph (runs once, before rendering). Returns named output artifacts. */
  build?: (ctx: BuildContext) => Record<string, Artifact> | void;
}

/** Split a node's opts into plain params + input edges (Artifact values, incl. arrays of them). */
function splitOpts(opts: Record<string, unknown>): { params: Record<string, unknown>; inputs: PlanNode["inputs"] } {
  const params: Record<string, unknown> = {};
  const inputs: PlanNode["inputs"] = [];
  for (const [key, val] of Object.entries(opts)) {
    if (isArtifact(val)) {
      inputs.push({ role: key, nodeId: val.nodeId });
    } else if (Array.isArray(val) && val.some(isArtifact)) {
      val.forEach((v, i) => {
        if (isArtifact(v)) inputs.push({ role: `${key}[${i}]`, nodeId: v.nodeId });
      });
    } else {
      params[key] = val;
    }
  }
  return { params, inputs };
}

export interface Plan {
  nodes: Map<string, PlanNode>;
  outputs: Record<string, Artifact>;
}

/** Run a composition's build() to capture its DAG. Bake-node creation is only legal during this pass. */
export function plan(def: CompositionDef): Plan {
  const nodes = new Map<string, PlanNode>();
  let active = true;

  const register = (kind: string, id: string, opts: Record<string, unknown>, dedupe = false): Artifact => {
    if (!active) {
      throw new Error(
        `FrameDiff: a "${kind}" build node ("${id}") was created outside build() — async/baked inputs must be ` +
          `declared in the composition's build(ctx), not during a frame render.`,
      );
    }
    const existing = nodes.get(id);
    if (existing) {
      if (dedupe && existing.kind === kind) return new Artifact(id, kind);
      throw new Error(`FrameDiff: duplicate build node id "${id}".`);
    }
    const { params, inputs } = splitOpts(opts);
    nodes.set(id, { id, kind, params, inputs });
    return new Artifact(id, kind);
  };

  const ctx: BuildContext = {
    asset: (assetId) => register("asset", assetId, { assetId }, true),
    precomp: (id, opts = {}) => register("precomp", id, opts),
    render3d: (id, opts = {}) => register("render3d", id, opts),
    generate: (id, opts = {}) => register("generate", id, opts),
    bake3d: (id, opts = {}) => register("bake3d", id, opts),
  };

  const outputs = (def.build?.(ctx) || {}) as Record<string, Artifact>;
  active = false; // planning done — a stashed ctx used during render now throws
  return { nodes, outputs };
}

/** A composition with a build graph is also a plain CompositionConfig (the no-build subset is the
 *  degenerate case), so Player / Studio / exportVideo accept either unchanged. */
export function defineComposition(def: CompositionDef): CompositionDef {
  return def;
}
