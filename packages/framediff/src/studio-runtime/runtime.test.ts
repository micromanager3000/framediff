import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompRegistry, StudioComposition } from "../studio/types";
import {
  compositionSourcePaths,
  createStudioRuntime,
  isCompositionTreeRuntimeEqual,
  isDocumentOnlyCompositionUpdate,
} from "./runtime";

const cameraSource = `export const CAMERAS = [
  { name: "shot", startCameraX: 1, startCameraY: 2, startCameraZ: 3 }
];`;

const composition = {
  id: "CameraComp",
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 48,
  html: `<!doctype html><main data-fd-composition data-fd-id="CameraComp" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48"><canvas data-fd-clip data-fd-id="shot" data-fd-name="shot" data-fd-from="0" data-fd-duration="48"></canvas></main>`,
  meta: {
    file: "src/comp.ts",
    sourceFormat: "generated",
    editableData: [{ type: "camera3d", file: "src/camera.ts", exportName: "CAMERAS" }],
  },
} satisfies StudioComposition;

describe("HtmlStudioRuntime Inspector batches", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rewrites an XYZ gesture atomically even when earlier literals grow", async () => {
    let transaction: { label: string; groupId?: string; files: Array<{ file: string; text: string }> } | undefined;
    const sources: Record<string, string> = { "src/comp.ts": "export {};", "src/camera.ts": cameraSource };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        return Response.json({ file, text: sources[file], hash: `hash:${file}` });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "edit-1", label: transaction!.label, before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: composition } as CompRegistry);
    await runtime.probe("main");

    const result = await runtime.editInspectorFields({
      compositionKey: "main",
      itemId: "shot",
      edits: [
        { fieldId: "data:src/camera.ts:CAMERAS:startCameraX", value: 10 },
        { fieldId: "data:src/camera.ts:CAMERAS:startCameraZ", value: 30 },
      ],
      label: "Move start camera",
      groupId: "gesture-1",
    });

    expect(result.ok).toBe(true);
    expect(transaction).toMatchObject({ label: "Move start camera", groupId: "gesture-1" });
    expect(transaction?.files).toHaveLength(1);
    expect(transaction?.files[0].text).toContain("startCameraX: 10");
    expect(transaction?.files[0].text).toContain("startCameraY: 2");
    expect(transaction?.files[0].text).toContain("startCameraZ: 30");
  });
});

describe("HtmlStudioRuntime first recorded motion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bootstraps a registered timeline and commits the fitted path as one source edit", async () => {
    const moduleSource = `import { defineComposition } from "framediff";
import source from "./Scene.html?raw";
export const sceneComp = defineComposition(source);`;
    const scene = {
      ...composition,
      id: "Scene",
      html: '<main data-fd-composition data-fd-id="Scene" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48"><div data-fd-id="orb"></div></main>',
      meta: {
        kind: "scene" as const,
        file: "src/Scene.html",
        module: "src/Scene.ts",
        exportName: "sceneComp",
        sourceFormat: "html" as const,
      },
    } satisfies StudioComposition;
    let transaction: { label: string; files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Scene.ts") return Response.json({ file, text: moduleSource, hash: "scene:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "motion-1", label: transaction!.label, before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ scene } as CompRegistry);

    const result = await runtime.createMotionPath!({
      compositionKey: "scene",
      objectId: "orb",
      path: "M10,20 C30,0 80,100 120,60",
      startFrame: 3,
      durationInFrames: 30,
      label: "Record orb gesture",
    });

    expect(result.ok).toBe(true);
    expect(transaction).toMatchObject({ label: "Record orb gesture", files: [{ file: "src/Scene.ts" }] });
    expect(transaction?.files[0].text).toContain('import { defineGsapTimeline } from "framediff/gsap";');
    expect(transaction?.files[0].text).toContain("setup: framediffRecordedMotionSetup");
    expect(transaction?.files[0].text).toContain('id: "orb-motion-path"');
    expect(transaction?.files[0].text).toContain('path: "M10,20 C30,0 80,100 120,60"');
  });
});

describe("HtmlStudioRuntime external timeline documents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes placement edits to JSON and patches only the affected composition", async () => {
    const timeline = {
      version: 1 as const,
      items: [{ id: "shot", from: 0, durationInFrames: 48, layer: 0, trimStart: 0 }],
    };
    const comp = {
      ...composition,
      timeline,
      meta: { ...composition.meta, timelineFile: "src/Camera.timeline.json" },
    } satisfies StudioComposition;
    let transaction: { files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Camera.timeline.json") return Response.json({ file, text: JSON.stringify(timeline), hash: "timeline:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "edit-timeline", label: "Edit timeline", before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: comp } as CompRegistry);
    await runtime.probe("main");

    const result = await runtime.editPlacements([
      { compositionKey: "main", itemId: "shot", field: "from", value: -24 },
      { compositionKey: "main", itemId: "shot", field: "durationInFrames", value: 72 },
      { compositionKey: "main", itemId: "shot", field: "trimStart", value: -1 },
    ]);

    expect(result.ok).toBe(true);
    expect(transaction?.files[0].file).toBe("src/Camera.timeline.json");
    expect(JSON.parse(transaction?.files[0].text ?? "{}")).toMatchObject({
      version: 1,
      items: [{ id: "shot", from: -24, durationInFrames: 72, trimStart: -1 }],
    });
    expect(runtime.getCompositions()[0].sources).toContain("src/Camera.timeline.json");
  });

  it("nests a dropped composition by committing HTML structure and timeline JSON together", async () => {
    const targetHtml = '<!doctype html><main data-fd-composition data-fd-id="Main" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="120" data-fd-kind="edit" data-fd-source="src/Main.html"></main>';
    const timeline = { version: 1 as const, items: [] };
    const target = {
      ...composition,
      id: "Main",
      durationInFrames: 120,
      html: targetHtml,
      timeline,
      meta: { kind: "edit" as const, file: "src/Main.html", sourceFormat: "html" as const, timelineFile: "src/Main.timeline.json" },
    } satisfies StudioComposition;
    const child = {
      ...composition,
      id: "Title",
      html: '<!doctype html><main data-fd-composition data-fd-id="Title" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48" data-fd-kind="scene"></main>',
      meta: { kind: "scene" as const, sourceFormat: "generated" as const },
    } satisfies StudioComposition;
    let transaction: { files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Main.html") return Response.json({ file, text: targetHtml, hash: "main:1" });
        if (file === "src/Main.timeline.json") return Response.json({ file, text: JSON.stringify(timeline), hash: "timeline:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "nest", label: "Nest Title in Main", before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: target, title: child } as CompRegistry);

    const result = await runtime.nestComposition("main", "title", 36);

    expect(result.ok).toBe(true);
    expect(transaction?.files.map((file) => file.file)).toEqual(["src/Main.html", "src/Main.timeline.json"]);
    expect(transaction?.files[0].text).toContain('data-fd-id="nested-title"');
    expect(transaction?.files[0].text).not.toContain('data-fd-from="36"');
    expect(JSON.parse(transaction?.files[1].text ?? "{}")).toEqual({
      version: 1,
      items: [{ id: "nested-title", from: 36, durationInFrames: 48 }],
    });
  });
});

describe("HtmlStudioRuntime composition documents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("projects bound JSON Schema properties and edits JSON without rewriting composition code", async () => {
    const document = { params: { strength: 2.5, tint: "#ff00aa", enabled: true } };
    const schema = { type: "object", properties: { params: { type: "object", properties: {
      strength: { type: "number", minimum: 0, maximum: 8 },
      tint: { type: "string", format: "color" },
      enabled: { type: "boolean" },
    } } } };
    const comp = {
      ...composition,
      document,
      meta: {
        ...composition.meta,
        document: { file: "src/Camera.comp.json", schema: "src/Camera.schema.json", bindings: { shot: "/params" } },
      },
    } satisfies StudioComposition;
    let transaction: { files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Camera.comp.json") return Response.json({ file, text: JSON.stringify(document), hash: "document:1" });
        if (file === "src/Camera.schema.json") return Response.json({ file, text: JSON.stringify(schema), hash: "schema:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "edit-document", label: "Edit document", before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: comp } as CompRegistry);
    await runtime.probe("main");

    const details = await runtime.inspectItem("main", "shot");
    expect(details.sections[0].fields.map((field) => field.control?.type)).toEqual(["number", "color", "boolean"]);
    const strength = details.sections[0].fields[0];
    const result = await runtime.editInspectorField({ compositionKey: "main", itemId: "shot", fieldId: strength.id, value: 4.5 });

    expect(result.ok).toBe(true);
    expect(JSON.parse(transaction?.files[0].text ?? "{}")).toMatchObject({ params: { strength: 4.5 } });
    expect(comp.document).toMatchObject({ params: { strength: 4.5 } });
    expect(runtime.getCompositions()[0].sources).toContain("src/Camera.comp.json");
    expect(runtime.getCompositions()[0].sources).not.toContain("src/Camera.schema.json");
  });

  it("commits direct geometry and text gestures to a bound JSON object, never the HTML", async () => {
    const document = { card: { x: 12, y: 20, width: 320, height: 180, text: "Original" } };
    const comp = {
      ...composition,
      document,
      meta: {
        ...composition.meta,
        file: "src/Camera.html",
        sourceFormat: "html" as const,
        document: { file: "src/Camera.comp.json", bindings: { shot: "/card" } },
      },
    } satisfies StudioComposition;
    const transactions: Array<{ files: Array<{ file: string; text: string }> }> = [];
    let documentText = JSON.stringify(document);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Camera.comp.json") return Response.json({ file, text: documentText, hash: `document:${transactions.length}` });
        if (file === "src/Camera.html") return Response.json({ file, text: composition.html, hash: "html:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        const transaction = JSON.parse(String(init.body));
        transactions.push(transaction);
        documentText = transaction.files[0].text;
        return Response.json({ ok: true, receipt: { id: `edit-${transactions.length}`, label: "Edit document", before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: comp } as CompRegistry);

    const geometry = await runtime.editElementProperties({
      compositionKey: "main",
      objectId: "shot",
      patch: { x: 44, y: 55, width: 640 },
      label: "Move card",
      groupId: "gesture-1",
    });
    const text = await runtime.editInspectorField({
      compositionKey: "main",
      itemId: "shot",
      fieldId: "html:data-fd-text",
      value: "Edited in JSON",
    });

    expect(geometry.ok).toBe(true);
    expect(text.ok).toBe(true);
    expect(transactions).toHaveLength(2);
    expect(transactions.every((transaction) => transaction.files[0].file === "src/Camera.comp.json")).toBe(true);
    expect(JSON.parse(transactions[0].files[0].text)).toMatchObject({ card: { x: 44, y: 55, width: 640, height: 180 } });
    expect(JSON.parse(transactions[1].files[0].text)).toMatchObject({ card: { text: "Edited in JSON" } });
    expect(comp.document).toMatchObject({ card: { x: 44, y: 55, width: 640, text: "Edited in JSON" } });
  });
});

describe("HtmlStudioRuntime composition invalidation graph", () => {
  it("patches a document-only registry update without treating code or timeline changes as data-only", () => {
    const before = { ...composition, document: { strength: 1 } } satisfies StudioComposition;
    const documentOnly = { ...before, document: { strength: 2 } } satisfies StudioComposition;
    const codeChange = { ...documentOnly, html: `${documentOnly.html}\n<!-- changed -->` } satisfies StudioComposition;
    const timelineChange = {
      ...documentOnly,
      timeline: { version: 1 as const, items: [{ id: "shot", from: 1, durationInFrames: 47 }] },
    } satisfies StudioComposition;

    expect(isDocumentOnlyCompositionUpdate(before, documentOnly)).toBe(true);
    expect(isDocumentOnlyCompositionUpdate(before, codeChange)).toBe(false);
    expect(isDocumentOnlyCompositionUpdate(before, timelineChange)).toBe(false);
  });

  it("includes nested JSON inputs in ancestor fingerprints but excludes unrelated comps and schemas", () => {
    const leaf = {
      ...composition,
      id: "Leaf",
      meta: {
        file: "src/Leaf.html",
        module: "src/Leaf.ts",
        document: { file: "src/Leaf.comp.json", schema: "src/Leaf.schema.json" },
      },
    } satisfies StudioComposition;
    const parent = {
      ...composition,
      id: "Parent",
      html: '<main data-fd-composition data-fd-id="Parent" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48"><div data-fd-clip data-fd-id="leaf" data-fd-type="nested" data-fd-comp="Leaf" data-fd-from="0" data-fd-duration="48"></div></main>',
      meta: { file: "src/Parent.html", module: "src/Parent.ts" },
    } satisfies StudioComposition;
    const unrelated = {
      ...composition,
      id: "Unrelated",
      meta: { file: "src/Unrelated.html", document: { file: "src/Unrelated.comp.json" } },
    } satisfies StudioComposition;
    const registry = { parent, leaf, unrelated } satisfies CompRegistry;

    expect(compositionSourcePaths(registry, "parent")).toEqual([
      "src/Parent.html",
      "src/Parent.ts",
      "src/Leaf.html",
      "src/Leaf.ts",
      "src/Leaf.comp.json",
    ]);
    expect(compositionSourcePaths(registry, "parent")).not.toContain("src/Leaf.schema.json");
    expect(compositionSourcePaths(registry, "parent")).not.toContain("src/Unrelated.comp.json");
    expect(compositionSourcePaths(registry, "unrelated")).toEqual(["src/Unrelated.html", "src/Unrelated.comp.json"]);
  });

  it("leaves unrelated preview trees alone but detects a changed document anywhere in a rendered tree", () => {
    const leafBefore = { ...composition, id: "Leaf", document: { strength: 1 } } satisfies StudioComposition;
    const leafAfter = { ...leafBefore, document: { strength: 2 } } satisfies StudioComposition;
    const parent = {
      ...composition,
      id: "Parent",
      html: '<main data-fd-composition data-fd-id="Parent" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48"><div data-fd-clip data-fd-id="leaf" data-fd-type="nested" data-fd-comp="Leaf" data-fd-from="0" data-fd-duration="48"></div></main>',
    } satisfies StudioComposition;
    const unrelated = { ...composition, id: "Unrelated", document: { value: 1 } } satisfies StudioComposition;
    const before = { parent, leaf: leafBefore, unrelated } satisfies CompRegistry;
    const after = {
      parent: { ...parent },
      leaf: leafAfter,
      unrelated: { ...unrelated, document: { value: 1 } },
    } satisfies CompRegistry;

    expect(isCompositionTreeRuntimeEqual(before, after, "parent")).toBe(false);
    expect(isCompositionTreeRuntimeEqual(before, after, "leaf")).toBe(false);
    expect(isCompositionTreeRuntimeEqual(before, after, "unrelated")).toBe(true);
  });
});

describe("HtmlStudioRuntime composition creation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates GENERATE compositions as editable generative recipes", async () => {
    const parentHtml = '<!doctype html><main data-fd-composition data-fd-id="Main" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="240" data-fd-kind="edit" data-fd-source="src/Main.html"></main>';
    const parent = {
      ...composition,
      id: "Main",
      html: parentHtml,
      meta: { file: "src/Main.html", sourceFormat: "html" as const },
    };
    const sources: Record<string, string> = {
      "src/Main.html": parentHtml,
      "src/config.ts": 'import { composition } from "./Main";\nexport const COMPOSITIONS = { main: composition };\n',
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (init?.method === "PUT") {
          sources[file] = String(init.body);
          return new Response("ok");
        }
        return file in sources
          ? Response.json({ file, text: sources[file], hash: `hash:${file}` })
          : new Response("missing", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: parent } as CompRegistry);

    const result = await runtime.createComposition({
      name: "New Shot",
      kind: "generate",
      durationInFrames: 120,
    }, "main");

    expect(result).toMatchObject({ ok: true, compositionKey: "new-shot" });
    expect(sources["src/NewShot.gen.ts"]).toContain('import { generative } from "framediff";');
    expect(sources["src/NewShot.gen.ts"]).toContain("export const newShotComp = generative({");
    expect(sources["src/NewShot.gen.ts"]).toContain('file: "src/NewShot.gen.ts"');
    expect(sources["src/NewShot.gen.ts"]).toContain("duration: 5");
    expect(sources["src/NewShot.gen.ts"]).toContain('aspect: "16:9"');
    expect(sources["src/NewShot.html"]).toBeUndefined();
    expect(sources["src/config.ts"]).toContain('import { newShotComp } from "./NewShot.gen";');
    expect(sources["src/config.ts"]).toContain('{ main: composition, "new-shot": newShotComp, }');
    expect(sources["src/Main.html"]).toContain('data-fd-name="NewShot"');
    expect(sources["src/Main.html"]).toContain('data-fd-type="nested" data-fd-comp="NewShot"');
    expect(result.message).toContain("nested it under Main");
  });

  it("keeps a new composition top-level when no parent is selected", async () => {
    const sources: Record<string, string> = {
      "src/config.ts": 'import { composition } from "./comp";\nexport const COMPOSITIONS = { main: composition };\n',
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (init?.method === "PUT") {
          sources[file] = String(init.body);
          return new Response("ok");
        }
        return file in sources
          ? Response.json({ file, text: sources[file], hash: `hash:${file}` })
          : new Response("missing", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: composition } as CompRegistry);

    const result = await runtime.createComposition({ name: "Top Level", kind: "edit", durationInFrames: 48 }, "");

    expect(result).toMatchObject({ ok: true, compositionKey: "top-level" });
    expect(result.message).toContain("at the top level");
    expect(sources["src/TopLevel.html"]).toContain('data-fd-timeline-source="src/TopLevel.timeline.json"');
    expect(JSON.parse(sources["src/TopLevel.timeline.json"])).toEqual({
      version: 1,
      items: [{ id: "title", from: 0, durationInFrames: 48, layer: 0 }],
    });
    expect(sources["src/TopLevel.ts"]).toContain('import document from "./TopLevel.comp.json";');
    expect(sources["src/TopLevel.ts"]).toContain("defineTimelineDocument(timeline)");
  });

  it("does not inject timeline clips into scene and document compositions", async () => {
    const sceneHtml = '<!doctype html><main data-fd-composition data-fd-id="Scene" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48" data-fd-kind="scene" data-fd-source="src/Scene.html"></main>';
    const scene = {
      ...composition,
      id: "Scene",
      html: sceneHtml,
      meta: { file: "src/Scene.html", sourceFormat: "html" as const, kind: "scene" as const },
    };
    const sources: Record<string, string> = {
      "src/Scene.html": sceneHtml,
      "src/config.ts": 'import { sceneComp } from "./Scene";\nexport const COMPOSITIONS = { scene: sceneComp };\n',
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (init?.method === "PUT") {
          sources[file] = String(init.body);
          return new Response("ok");
        }
        return file in sources
          ? Response.json({ file, text: sources[file], hash: `hash:${file}` })
          : new Response("missing", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ scene } as CompRegistry);

    const result = await runtime.createComposition({ name: "Notes", kind: "doc", durationInFrames: 48 }, "scene");

    expect(result).toMatchObject({ ok: true, compositionKey: "notes" });
    expect(result.message).toContain("at the top level");
    expect(sources["src/Scene.html"]).toBe(sceneHtml);
    expect(sources["src/Notes.html"]).toContain('data-fd-kind="doc"');
    expect(sources["src/Notes.html"]).not.toContain("<section data-fd-clip");
    expect(sources["src/Notes.html"]).toContain('data-fd-document="src/Notes.comp.json"');
    expect(JSON.parse(sources["src/Notes.comp.json"])).toMatchObject({
      title: { text: "Notes" },
      body: { text: "Start authoring here." },
    });
    expect(JSON.parse(sources["src/Notes.schema.json"])).toMatchObject({ type: "object" });
    expect(sources["src/Notes.ts"]).toContain('bindings: {"document-title":"/title","document-body":"/body"}');
  });
});
