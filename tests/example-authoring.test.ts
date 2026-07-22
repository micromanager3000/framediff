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
const sourceFiles = filesBelow(examplesRoot).filter((file) => /\.(?:ts|html)$/.test(file));
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
    const allSource = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    if (allSource.includes("defineMoodboardComposition(")) kinds.add("moodboard");
    if (allSource.includes("generative(")) kinds.add("generate");

    expect([...kinds].sort()).toEqual([
      "3d", "audio", "board", "cast", "doc", "edit", "generate", "locations",
      "moodboard", "plan", "scene", "script", "storyboard",
    ]);
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
        items: Array<{ id: string }>;
      };
      expect(timeline.version, relative(repositoryRoot, timelineFile)).toBe(1);
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
    }
  });

  it("backs directly editable authored comps with JSON and optional schemas", () => {
    const dataKinds = new Set(["scene", "3d", "audio", "plan", "doc", "script", "storyboard", "board", "locations", "cast"]);
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
