// The cache key for a build node — a Merkle hash over (kind, toolchain, params, target, input byte
// hashes). NOT the content hash (that's the hash of the produced bytes). The lockfile is never an
// input here (it only maps fingerprint → contentHash for already-known keys), so changing a pin can
// never change a fingerprint. Completeness — that nothing outside these inputs changes the bytes — is
// enforced by the property test in fingerprint.test.ts.

import { canonicalJSON } from "./canonicalJSON";
import { hashString, type Hash } from "./hash";

export interface Toolchain {
  /** Bump when the baker/effect algorithm itself changes. */
  recipeVersion: string;
  /** Canonical hash of the node's first-party source modules (computed identically across runners). */
  codeHash: Hash;
  /** Resolved versions of output-affecting dependencies (three, html-to-image, the LUT parser, …). */
  deps: Record<string, string>;
  /** For GPU/encoder-touching nodes: encoder identity (e.g. "prefer-software"). */
  runtime?: string;
}

export interface ResolvedInput {
  /** "source" | "mask" | "audio" | "lut" | … */
  role: string;
  /** The upstream node's cache key (bookkeeping; NOT folded into this fingerprint). */
  fingerprint: Hash;
  /** The exact bytes this node will read — THIS is what binds the fingerprint to content. */
  contentHash: Hash;
}

export interface BuildNode {
  /** "precomp" | "render3d" | "generate" | "asset" | "effect" | … */
  kind: string;
  toolchain: Toolchain;
  /** resolution, fps, duration, effect props, prompt, model, seed, … */
  params: Record<string, unknown>;
  /** How (or whether) the render target folds in — each node kind decides; null = doesn't depend on it. */
  targetKey?: unknown;
}

/**
 * Fingerprint a node from its declared recipe + the *content hashes* of its resolved inputs.
 * Inputs are bound by byte content (not upstream recipe), so an upstream that produces identical
 * bytes yields an identical key (content-addressed reuse); any byte change re-keys downstream.
 */
export async function fingerprint(node: BuildNode, inputs: ResolvedInput[]): Promise<Hash> {
  const payload = {
    kind: node.kind,
    toolchain: node.toolchain,
    params: node.params,
    target: node.targetKey ?? null,
    inputs: inputs
      .map((i) => ({ role: i.role, contentHash: i.contentHash }))
      .sort((a, b) => (a.role + a.contentHash < b.role + b.contentHash ? -1 : 1)),
  };
  return hashString(canonicalJSON(payload));
}
