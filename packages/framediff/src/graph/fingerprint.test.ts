import { describe, it, expect } from "vitest";
import { fingerprint, type BuildNode, type ResolvedInput } from "./fingerprint";

const node = (): BuildNode => ({
  kind: "precomp",
  toolchain: { recipeVersion: "1", codeHash: "sha256:code", deps: { three: "0.160.0" }, runtime: "prefer-software" },
  params: { width: 1920, height: 1080, fps: 30 },
  targetKey: { w: 1920, h: 1080, fps: 30 },
});
const inputs = (): ResolvedInput[] => [{ role: "source", fingerprint: "sha256:up", contentHash: "sha256:bytesA" }];

describe("fingerprint completeness", () => {
  it("is stable for identical inputs", async () => {
    expect(await fingerprint(node(), inputs())).toBe(await fingerprint(node(), inputs()));
  });

  it("changes when ANY declared input changes (nothing outside it is silently ignored)", async () => {
    const base = await fingerprint(node(), inputs());
    const mutated: Record<string, () => Promise<string>> = {
      kind: () => fingerprint({ ...node(), kind: "render3d" }, inputs()),
      recipeVersion: () => fingerprint({ ...node(), toolchain: { ...node().toolchain, recipeVersion: "2" } }, inputs()),
      codeHash: () => fingerprint({ ...node(), toolchain: { ...node().toolchain, codeHash: "sha256:code2" } }, inputs()),
      depVersion: () => fingerprint({ ...node(), toolchain: { ...node().toolchain, deps: { three: "0.161.0" } } }, inputs()),
      runtime: () => fingerprint({ ...node(), toolchain: { ...node().toolchain, runtime: "prefer-hardware" } }, inputs()),
      param: () => fingerprint({ ...node(), params: { width: 1280, height: 720, fps: 30 } }, inputs()),
      target: () => fingerprint({ ...node(), targetKey: { w: 3840, h: 2160, fps: 30 } }, inputs()),
      inputContentHash: () => fingerprint(node(), [{ role: "source", fingerprint: "sha256:up", contentHash: "sha256:bytesB" }]),
      inputRole: () => fingerprint(node(), [{ role: "mask", fingerprint: "sha256:up", contentHash: "sha256:bytesA" }]),
      extraInput: () => fingerprint(node(), [...inputs(), { role: "lut", fingerprint: "sha256:l", contentHash: "sha256:lut" }]),
    };
    for (const [name, mut] of Object.entries(mutated)) {
      expect(await mut(), `mutating ${name} must change the fingerprint`).not.toBe(base);
    }
  });

  it("does NOT change when only an upstream fingerprint changes — bytes bind, not recipe (content-addressed)", async () => {
    const a = await fingerprint(node(), [{ role: "source", fingerprint: "sha256:up1", contentHash: "sha256:same" }]);
    const b = await fingerprint(node(), [{ role: "source", fingerprint: "sha256:up2", contentHash: "sha256:same" }]);
    expect(a).toBe(b);
  });

  it("is order-independent across inputs", async () => {
    const i1: ResolvedInput[] = [
      { role: "a", fingerprint: "f", contentHash: "x" },
      { role: "b", fingerprint: "f", contentHash: "y" },
    ];
    expect(await fingerprint(node(), i1)).toBe(await fingerprint(node(), [...i1].reverse()));
  });

  // The lockfile is structurally NOT an input: fingerprint() has no parameter for it, so a pin can
  // never change a fingerprint.
});
