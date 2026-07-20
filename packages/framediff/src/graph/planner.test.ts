import { describe, it, expect } from "vitest";
import { plan, defineComposition, Artifact, type PlanNode } from "./planner";
import { validateGraph, topoSort, resolveGraph, type Baker } from "./scheduler";
import type { Toolchain } from "./fingerprint";

const tc = (): Toolchain => ({ recipeVersion: "1", codeHash: "sha256:c", deps: {} });
const base = { html: '<main data-fd-composition data-fd-id="X" data-fd-width="1920" data-fd-height="1080" data-fd-fps="30" data-fd-duration="30"></main>', width: 1920, height: 1080, fps: 30, durationInFrames: 30 };

describe("planner", () => {
  it("captures a DAG with dependency edges from passed-in Artifacts", () => {
    const p = plan(
      defineComposition({
        id: "X",
        ...base,
        build(ctx) {
          const glb = ctx.asset("dragon-glb");
          const r3d = ctx.render3d("dragon", { model: glb, clip: "fly" });
          const gen = ctx.generate("styled", { input: r3d, prompt: "stained glass" });
          return { styled: gen };
        },
      }),
    );
    expect([...p.nodes.keys()].sort()).toEqual(["dragon", "dragon-glb", "styled"]);
    expect(p.nodes.get("dragon")!.inputs).toEqual([{ role: "model", nodeId: "dragon-glb" }]);
    expect(p.nodes.get("dragon")!.params).toEqual({ clip: "fly" });
    expect(p.nodes.get("styled")!.inputs).toEqual([{ role: "input", nodeId: "dragon" }]);
    expect(p.outputs.styled).toBeInstanceOf(Artifact);
  });

  it("dedupes asset() but errors on a duplicate node id", () => {
    const p = plan(defineComposition({ id: "X", ...base, build: (ctx) => void (ctx.asset("a"), ctx.asset("a")) }));
    expect(p.nodes.size).toBe(1);
    expect(() => plan(defineComposition({ id: "X", ...base, build: (ctx) => void (ctx.precomp("p"), ctx.precomp("p")) }))).toThrow(/duplicate/);
  });

  it("guards against creating bake nodes after planning (the per-frame-render guard)", () => {
    let stash: { precomp: (id: string) => unknown } | undefined;
    plan(defineComposition({ id: "X", ...base, build: (ctx) => void (stash = ctx) }));
    expect(() => stash!.precomp("late")).toThrow(/outside build/);
  });
});

describe("scheduler", () => {
  const graph = (...ns: PlanNode[]) => new Map(ns.map((n) => [n.id, n]));

  it("detects missing inputs and cycles", () => {
    expect(validateGraph(graph({ id: "a", kind: "x", params: {}, inputs: [{ role: "r", nodeId: "missing" }] })).join()).toMatch(/missing/);
    const cyc = graph(
      { id: "a", kind: "x", params: {}, inputs: [{ role: "r", nodeId: "b" }] },
      { id: "b", kind: "x", params: {}, inputs: [{ role: "r", nodeId: "a" }] },
    );
    expect(validateGraph(cyc).join()).toMatch(/cycle/);
  });

  it("topo-sorts bottom-up (inputs before consumers)", () => {
    const g = graph(
      { id: "gen", kind: "generate", params: {}, inputs: [{ role: "input", nodeId: "r3d" }] },
      { id: "r3d", kind: "render3d", params: {}, inputs: [{ role: "model", nodeId: "glb" }] },
      { id: "glb", kind: "asset", params: {}, inputs: [] },
    );
    expect(topoSort(g).map((n) => n.id)).toEqual(["glb", "r3d", "gen"]);
  });

  it("resolves bottom-up, fingerprints, and cache-hits unchanged nodes", async () => {
    const g = graph(
      { id: "r3d", kind: "render3d", params: { clip: "fly" }, inputs: [{ role: "model", nodeId: "glb" }] },
      { id: "glb", kind: "asset", params: { assetId: "glb" }, inputs: [] },
    );
    let bakes = 0;
    const bakers: Record<string, Baker> = {
      asset: async () => ((bakes++), { contentHash: "sha256:glbbytes" }),
      render3d: async (_n, inputs) => ((bakes++), { contentHash: "sha256:r3d-" + inputs[0].contentHash }),
    };
    const cache = new Map<string, import("./scheduler").ResolvedNode>();
    const cacheAdapter = { get: (fp: string) => cache.get(fp), set: (fp: string, r: import("./scheduler").ResolvedNode) => void cache.set(fp, r) };

    const r1 = await resolveGraph(g, { bakers, toolchain: tc, cache: cacheAdapter });
    expect(r1.get("glb")!.contentHash).toBe("sha256:glbbytes");
    expect(r1.get("r3d")!.contentHash).toBe("sha256:r3d-sha256:glbbytes");
    expect(bakes).toBe(2);

    // second pass: every fingerprint is known ⇒ zero bakes
    const r2 = await resolveGraph(g, { bakers, toolchain: tc, cache: cacheAdapter });
    expect(bakes).toBe(2);
    expect(r2.get("r3d")!.fingerprint).toBe(r1.get("r3d")!.fingerprint);
  });
});
