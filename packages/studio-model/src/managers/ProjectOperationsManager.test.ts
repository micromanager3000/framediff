import { describe, expect, it } from "vitest";
import type { CacheEntryDescriptor, CompositionBakeInputsSnapshot, CompositionDescriptor } from "../types";
import { COMPOSITION_KIND_CONTRACTS } from "../authoring";
import { compositionBakeSnapshot } from "./ProjectOperationsManager";

const composition: CompositionDescriptor = {
  key: "camera",
  id: "Camera",
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 48,
  definitionVersion: 1,
  type: "three",
  kind: "scene",
  outputKind: "video",
  file: "src/Camera.ts",
  sources: ["src/Camera.ts", "src/Camera.comp.json"],
};

async function hash(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("composition bake status", () => {
  it("marks the current composition stale when its JSON document changes", async () => {
    const source = new Map([
      ["src/Camera.ts", "export const camera = true;"],
      ["src/Camera.comp.json", "{\"x\":1}"],
    ]);
    const cache: CacheEntryDescriptor[] = [{
      name: "camera.mp4",
      size: 100,
      mtimeMs: 1,
      compId: "Camera",
      inputs: {
        "src/Camera.ts": await hash(source.get("src/Camera.ts")!),
        "src/Camera.comp.json": await hash(source.get("src/Camera.comp.json")!),
      },
    }];
    const inputs = async (): Promise<CompositionBakeInputsSnapshot> => ({
      inputs: Object.fromEntries(await Promise.all([...source].map(async ([file, text]) => [file, await hash(text)]))),
      missing: [],
    });

    const current = await compositionBakeSnapshot(composition, cache, inputs);
    expect(current.status).toBe("current");
    expect(current.artifact).toBe(cache[0]);
    source.set("src/Camera.comp.json", "{\"x\":2}");
    const stale = await compositionBakeSnapshot(composition, cache, inputs);
    expect(stale.status).toBe("stale");
    expect(stale.artifact).toBeUndefined();
  });

  it("distinguishes a missing bake from legacy artifacts without fingerprints", async () => {
    const inputs = async () => ({ inputs: {}, missing: [] });
    expect((await compositionBakeSnapshot(composition, [], inputs)).status).toBe("missing");
    expect((await compositionBakeSnapshot(composition, [{ name: "old.mp4", size: 100, mtimeMs: 1, compId: "Camera" }], inputs)).status).toBe("untracked");
  });

  it("treats an unresolved declared input as stale", async () => {
    const cache: CacheEntryDescriptor[] = [{
      name: "camera.mp4", size: 100, mtimeMs: 1, compId: "Camera",
      inputs: { "src/Camera.ts": await hash("source") },
    }];
    const inputs = async () => ({ inputs: { "src/Camera.ts": await hash("source") }, missing: ["asset://plate"] });
    expect((await compositionBakeSnapshot(composition, cache, inputs)).status).toBe("stale");
  });

  it("selects the newest artifact that matches the current inputs", async () => {
    const contentHash = await hash("source");
    const cache: CacheEntryDescriptor[] = [
      { name: "older", contentHash: "sha256:older", size: 100, mtimeMs: 1, compId: "Camera", inputs: { "src/Camera.ts": contentHash } },
      { name: "stale", contentHash: "sha256:stale", size: 100, mtimeMs: 3, compId: "Camera", inputs: { "src/Camera.ts": "sha256:stale" } },
      { name: "newer", contentHash: "sha256:newer", size: 100, mtimeMs: 2, compId: "Camera", inputs: { "src/Camera.ts": contentHash } },
    ];
    const snapshot = await compositionBakeSnapshot(composition, cache, async () => ({ inputs: { "src/Camera.ts": contentHash }, missing: [] }));

    expect(snapshot.status).toBe("current");
    expect(snapshot.artifact?.contentHash).toBe("sha256:newer");
  });

  it.each(COMPOSITION_KIND_CONTRACTS.map(({ kind }) => [kind] as const))(
    "uses the same runtime bake inputs for %s compositions",
    async (kind) => {
      const entry = { ...composition, kind, key: kind, id: `Comp-${kind}` };
      const input = `composition://${kind}`;
      const contentHash = await hash(kind);
      const cache: CacheEntryDescriptor[] = [{ name: `${kind}.mp4`, size: 1, mtimeMs: 1, compId: entry.id, inputs: { [input]: contentHash } }];
      expect((await compositionBakeSnapshot(entry, cache, async (key) => ({ inputs: { [`composition://${key}`]: contentHash }, missing: [] }))).status).toBe("current");
    },
  );
});
