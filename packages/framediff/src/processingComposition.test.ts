import { describe, expect, it } from "vitest";
import { fingerprintProcessingRecipe, type ProcessingCompositionDocument, type ProcessingRecipe } from "@framediff/studio-model";
import { processing, processingChannelCacheUrl } from "./processingComposition";

const recipe = (): ProcessingRecipe => ({
  version: 1,
  kind: "processing",
  id: "remove-background",
  inputs: [{ name: "source", contentHash: "sha256:source", mime: "video/mp4" }],
  parameters: { output: ["foreground", "matte"] },
  provenance: {
    processor: "rvm",
    model: "robust-video-matting",
    modelRevision: "sha256:weights",
    runtime: "pytorch",
    runtimeRevision: "2.8.0",
  },
});

describe("processing composition", () => {
  it("materializes the pinned RVM foreground as a real transparent composition", async () => {
    const value = recipe();
    const fingerprint = await fingerprintProcessingRecipe(value);
    const timing = { fps: 30, frameCount: 60 };
    const document: ProcessingCompositionDocument = {
      recipe: value,
      recipeFingerprint: fingerprint,
      pinnedRecipeFingerprint: fingerprint,
      artifact: {
        version: 1,
        kind: "processing-artifact",
        recipeFingerprint: fingerprint,
        inputs: value.inputs,
        provenance: value.provenance,
        channels: {
          foreground: { name: "foreground", contentHash: "sha256:foreground", mime: "video/webm", bytes: 100, dimensions: { width: 1920, height: 1080 }, timing },
          matte: { name: "matte", contentHash: "sha256:matte", mime: "video/webm", bytes: 50, dimensions: { width: 1920, height: 1080 }, timing },
        },
      },
    };
    const composition = processing({ id: "Subject", dataFile: "src/Subject.process.json", width: 1920, height: 1080, fps: 30, durationInFrames: 60, document });
    expect(composition.definition).toEqual({ version: 2, type: "processing", kind: "scene", dataMode: "json" });
    expect(composition.meta).toMatchObject({ output: "video", library: true, sourceFormat: "generated" });
    expect(composition.processingOutputChannel).toBe("foreground");
    expect(composition.html).toContain(`data-fd-src="${processingChannelCacheUrl("sha256:foreground")}"`);
    expect(composition.html).toContain("processing-slate\" hidden");
  });

  it("shows a deterministic slate until an artifact is pinned", () => {
    const document: ProcessingCompositionDocument = { recipe: recipe(), recipeFingerprint: null, artifact: null, pinnedRecipeFingerprint: null };
    const composition = processing({ id: "Subject", dataFile: "src/Subject.process.json", width: 1280, height: 720, fps: 24, durationInFrames: 120, document });
    expect(composition.meta?.output).toBe("video");
    expect(composition.html).toContain("no artifact yet — run processing from Studio");
    expect(composition.html).not.toContain("processing-slate\" hidden");
  });
});
