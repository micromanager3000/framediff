import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const examplesRoot = join(repositoryRoot, "examples");

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

const htmlFiles = filesBelow(examplesRoot).filter((file) => file.endsWith(".html"));
const timelineFiles = filesBelow(examplesRoot).filter((file) => file.endsWith(".timeline.json"));
const attribute = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1];
const rootTag = (source: string): string =>
  source.match(/<[^>]+\bdata-fd-composition(?:\s|=|>)[^>]*>/i)?.[0] ?? "";
const exampleRootFor = (file: string): string => {
  const parts = relative(examplesRoot, file).split(/[\\/]/);
  return join(examplesRoot, parts[0]!);
};

describe("example composition authoring contracts", () => {
  it("keeps a real example for every public composition kind", () => {
    const kinds = new Set(
      htmlFiles.map((file) => attribute(rootTag(readFileSync(file, "utf8")), "data-fd-kind")).filter(Boolean),
    );
    expect([...kinds].sort()).toEqual([
      "audio", "board", "cast", "doc", "edit", "locations", "plan", "scene", "script",
    ]);
  });

  it("routes every Studio example through the versioned registry boundary", () => {
    const configs = filesBelow(examplesRoot).filter((file) => file.endsWith("/src/config.ts"));
    const registries = configs.filter((file) => readFileSync(file, "utf8").includes("COMPOSITIONS"));
    expect(registries.length).toBeGreaterThan(0);
    for (const file of registries) {
      expect(readFileSync(file, "utf8"), relative(repositoryRoot, file)).toContain("defineCompositionRegistry(");
    }
  });

  it("stores authored edit placement in external timeline documents", () => {
    const editFiles = htmlFiles.filter((file) => attribute(rootTag(readFileSync(file, "utf8")), "data-fd-kind") === "edit");
    expect(editFiles.length).toBeGreaterThan(0);

    for (const file of editFiles) {
      const source = readFileSync(file, "utf8");
      const root = rootTag(source);
      const timelineSource = attribute(root, "data-fd-timeline-source");
      expect(timelineSource, relative(repositoryRoot, file)).toBeTruthy();
      const timelineFile = join(exampleRootFor(file), timelineSource!);
      expect(existsSync(timelineFile), timelineSource).toBe(true);
      const timeline = JSON.parse(readFileSync(timelineFile, "utf8")) as {
        version: number;
        items: Array<{ id: string; content?: unknown }>;
      };
      expect([1, 2], relative(repositoryRoot, timelineFile)).toContain(timeline.version);
      const placementIds = new Set(timeline.items.map((item) => item.id));

      const bodyWithoutRoot = source.replace(root, "");
      expect(bodyWithoutRoot, relative(repositoryRoot, file)).not.toMatch(
        /\bdata-fd-(?:from|duration|layer|trim-start|playback-rate)=/,
      );
      for (const match of bodyWithoutRoot.matchAll(/<[^>]+\bdata-fd-clip(?:\s|=|>)[^>]*>/gi)) {
        const id = attribute(match[0], "data-fd-id");
        expect(id, `${relative(repositoryRoot, file)} has a clip without a stable id`).toBeTruthy();
        expect(placementIds.has(id!), `${relative(repositoryRoot, timelineFile)} is missing ${id}`).toBe(true);
      }
      const hasInlineCreativeData = /\bdata-fd-text="|\bdata-fd-grade-(?:exposure|contrast|saturation|temperature|tint|highlights|shadows|vignette|bloom|bloom-threshold|lut|lut-intensity)="/.test(source);
      if (hasInlineCreativeData) {
        expect(attribute(root, "data-fd-document"), `${relative(repositoryRoot, file)} has inline creative data without JSON authority`).toBeTruthy();
      }
    }
  });

  it("keeps every timeline placement typed, stable, and finite", () => {
    const contentTypes = new Set(["nested", "video", "audio", "shape", "layers", "camera", "grade-layer"]);
    expect(timelineFiles.length).toBeGreaterThan(0);

    for (const file of timelineFiles) {
      const timeline = JSON.parse(readFileSync(file, "utf8")) as {
        version: number;
        items: Array<{
          id: string;
          from: number;
          durationInFrames: number;
          content?: { type?: string; src?: string; composition?: string; camera?: string };
        }>;
      };
      expect([1, 2], relative(repositoryRoot, file)).toContain(timeline.version);
      expect(Array.isArray(timeline.items), relative(repositoryRoot, file)).toBe(true);
      const ids = new Set<string>();
      for (const item of timeline.items) {
        expect(item.id, `${relative(repositoryRoot, file)} has an unstable placement`).toBeTruthy();
        expect(ids.has(item.id), `${relative(repositoryRoot, file)} duplicates ${item.id}`).toBe(false);
        ids.add(item.id);
        expect(Number.isFinite(item.from), `${relative(repositoryRoot, file)}:${item.id} start`).toBe(true);
        expect(Number.isFinite(item.durationInFrames), `${relative(repositoryRoot, file)}:${item.id} duration`).toBe(true);
        expect(item.durationInFrames, `${relative(repositoryRoot, file)}:${item.id} duration`).toBeGreaterThan(0);
        expect(item.content, `${relative(repositoryRoot, file)}:${item.id} uses legacy HTML-backed content`).toBeTruthy();
        expect(contentTypes.has(item.content?.type ?? ""), `${relative(repositoryRoot, file)}:${item.id} content type`).toBe(true);
        if (item.content?.type === "video" || item.content?.type === "audio") {
          expect(item.content.src, `${relative(repositoryRoot, file)}:${item.id} source`).toBeTruthy();
        }
        if (item.content?.type === "nested") {
          expect(item.content.composition, `${relative(repositoryRoot, file)}:${item.id} nested composition`).toBeTruthy();
        }
        if (item.content?.type === "camera") {
          expect(item.content.camera, `${relative(repositoryRoot, file)}:${item.id} camera`).toBeTruthy();
        }
      }
    }
  });

  it("keeps code scenes source-owned and timeline-less without inventing another kind", () => {
    const codeSceneFiles = htmlFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      const root = rootTag(source);
      return attribute(root, "data-fd-kind") === "scene"
        && attribute(root, "data-fd-timeline") === "hidden"
        && !attribute(root, "data-fd-document")
        && source.includes("onFrame(");
    });
    expect(codeSceneFiles.length).toBeGreaterThan(0);

    for (const file of codeSceneFiles) {
      const root = rootTag(readFileSync(file, "utf8"));
      expect(attribute(root, "data-fd-timeline"), relative(repositoryRoot, file)).toBe("hidden");
      expect(attribute(root, "data-fd-data-mode"), relative(repositoryRoot, file)).toBe("source");
      expect(attribute(root, "data-fd-transport"), relative(repositoryRoot, file)).toBe("always");
      expect(attribute(root, "data-fd-document"), relative(repositoryRoot, file)).toBeUndefined();
      expect(attribute(root, "data-fd-schema"), relative(repositoryRoot, file)).toBeUndefined();
      expect(attribute(root, "data-fd-timeline-source"), relative(repositoryRoot, file)).toBeUndefined();
      expect(readFileSync(file, "utf8"), relative(repositoryRoot, file)).toContain("onFrame(");
    }
  });

  it("makes every example's creative-data ownership explicit", () => {
    for (const file of htmlFiles) {
      const root = rootTag(readFileSync(file, "utf8"));
      if (!root) continue;
      const jsonFiles = [attribute(root, "data-fd-document"), attribute(root, "data-fd-timeline-source")].filter(Boolean);
      const dataMode = attribute(root, "data-fd-data-mode") ?? (jsonFiles.length ? "json" : undefined);
      expect(dataMode, relative(repositoryRoot, file)).toBeTruthy();
      expect(["json", "source"], relative(repositoryRoot, file)).toContain(dataMode);
      if (dataMode === "source") {
        expect(attribute(root, "data-fd-kind"), relative(repositoryRoot, file)).toBe("scene");
        expect(attribute(root, "data-fd-timeline"), relative(repositoryRoot, file)).toBe("hidden");
        const moduleFile = attribute(root, "data-fd-module");
        expect(moduleFile, relative(repositoryRoot, file)).toBeTruthy();
        const sourceMarker = file.lastIndexOf("/src/");
        const modulePath = `${file.slice(0, sourceMarker)}/${moduleFile}`;
        expect(readFileSync(modulePath, "utf8"), relative(repositoryRoot, modulePath)).toContain("defineCodeScene(");
      }
    }
  });

  it("backs directly editable authored comps with JSON and optional schemas", () => {
    const dataKinds = new Set(["audio", "plan", "doc", "script", "board", "locations", "cast"]);
    const dataFiles = htmlFiles.filter((file) => dataKinds.has(attribute(rootTag(readFileSync(file, "utf8")), "data-fd-kind") ?? ""));
    expect(dataFiles.length).toBeGreaterThan(0);

    for (const file of dataFiles) {
      const root = rootTag(readFileSync(file, "utf8"));
      const documentSource = attribute(root, "data-fd-document");
      expect(documentSource, relative(repositoryRoot, file)).toBeTruthy();
      expect(existsSync(join(exampleRootFor(file), documentSource!)), documentSource).toBe(true);
      const schemaSource = attribute(root, "data-fd-schema");
      if (schemaSource) expect(existsSync(join(exampleRootFor(file), schemaSource)), schemaSource).toBe(true);
    }
  });

  it("keeps each declared source, module, document, schema, and timeline path portable", () => {
    for (const file of htmlFiles) {
      const root = rootTag(readFileSync(file, "utf8"));
      if (!root) continue;
      const exampleRoot = exampleRootFor(file);
      for (const name of ["data-fd-source", "data-fd-module", "data-fd-document", "data-fd-schema", "data-fd-timeline-source"]) {
        const declared = attribute(root, name);
        if (declared) expect(existsSync(join(exampleRoot, declared)), `${relative(repositoryRoot, file)}: ${name}=${declared}`).toBe(true);
      }
    }
  });
});
