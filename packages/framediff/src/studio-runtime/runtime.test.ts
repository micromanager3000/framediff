import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompRegistry, StudioComposition } from "../studio/types";
import { createStudioRuntime } from "./runtime";

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
  });
});
