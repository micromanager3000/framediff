// Schedule a build graph: validate it (missing nodes, cycles), order it bottom-up, and resolve each
// node — fingerprint it (P0), reuse a cached artifact if the fingerprint is known, else bake it. The
// per-kind bakers (precomp → recursive export, render3d, generate) are injected; this is the
// deterministic spine they plug into.

import { fingerprint, type ResolvedInput, type Toolchain } from "./fingerprint";
import type { Hash } from "./hash";
import type { PlanNode } from "./planner";

export function validateGraph(nodes: Map<string, PlanNode>): string[] {
  const errors: string[] = [];
  for (const n of nodes.values()) {
    for (const inp of n.inputs) {
      if (!nodes.has(inp.nodeId)) errors.push(`node "${n.id}" references missing node "${inp.nodeId}"`);
    }
  }
  // cycle detection (DFS colouring)
  const color = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 in-stack, 2 done
  const stack: string[] = [];
  const visit = (id: string): boolean => {
    const c = color.get(id) ?? 0;
    if (c === 1) {
      const from = stack.indexOf(id);
      errors.push(`cycle: ${[...stack.slice(from), id].join(" → ")}`);
      return false;
    }
    if (c === 2) return true;
    color.set(id, 1);
    stack.push(id);
    for (const inp of nodes.get(id)!.inputs) {
      if (nodes.has(inp.nodeId)) visit(inp.nodeId);
    }
    stack.pop();
    color.set(id, 2);
    return true;
  };
  for (const id of nodes.keys()) if ((color.get(id) ?? 0) === 0) visit(id);
  return errors;
}

/** Bottom-up order: a node appears after all of its inputs. Throws if the graph is invalid. */
export function topoSort(nodes: Map<string, PlanNode>): PlanNode[] {
  const errors = validateGraph(nodes);
  if (errors.length) throw new Error("invalid build graph:\n  " + errors.join("\n  "));
  const order: PlanNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = nodes.get(id)!;
    for (const inp of n.inputs) visit(inp.nodeId);
    order.push(n);
  };
  for (const id of nodes.keys()) visit(id);
  return order;
}

export interface ResolvedNode {
  fingerprint: Hash;
  contentHash: Hash;
  /** the baker's output handed to consumers (e.g. a MediaBundle / resolved URL). */
  value?: unknown;
}

export type Baker = (node: PlanNode, inputs: ResolvedInput[]) => Promise<{ contentHash: Hash; value?: unknown }>;

export interface ResolveOptions {
  /** per-kind bakers (cache misses run these). */
  bakers: Record<string, Baker>;
  /** the toolchain (codeHash + dep versions …) for a node — folded into its fingerprint. */
  toolchain: (node: PlanNode) => Toolchain;
  /** how the render target folds into a node's fingerprint (per-kind; default: not at all). */
  targetKey?: (node: PlanNode) => unknown;
  /** fingerprint → cached artifact (local build index / lockfile / CAS). Optional. */
  cache?: { get(fp: Hash): ResolvedNode | undefined; set(fp: Hash, r: ResolvedNode): void };
}

/** Resolve the whole graph bottom-up: fingerprint → cache hit (no work) or bake. Returns a map keyed
 *  by node id. Because step "bake" is keyed by fingerprint, an unchanged subtree is a pure cache hit. */
export async function resolveGraph(nodes: Map<string, PlanNode>, opts: ResolveOptions): Promise<Map<string, ResolvedNode>> {
  const order = topoSort(nodes);
  const resolved = new Map<string, ResolvedNode>();
  for (const node of order) {
    const inputs: ResolvedInput[] = node.inputs.map((i) => {
      const r = resolved.get(i.nodeId)!;
      return { role: i.role, fingerprint: r.fingerprint, contentHash: r.contentHash };
    });
    const fp = await fingerprint(
      { kind: node.kind, toolchain: opts.toolchain(node), params: node.params, targetKey: opts.targetKey?.(node) },
      inputs,
    );
    let entry = opts.cache?.get(fp);
    if (!entry) {
      const baker = opts.bakers[node.kind];
      if (!baker) throw new Error(`no baker registered for node kind "${node.kind}"`);
      const baked = await baker(node, inputs);
      entry = { fingerprint: fp, contentHash: baked.contentHash, value: baked.value };
      opts.cache?.set(fp, entry);
    }
    resolved.set(node.id, { fingerprint: fp, contentHash: entry.contentHash, value: entry.value });
  }
  return resolved;
}
