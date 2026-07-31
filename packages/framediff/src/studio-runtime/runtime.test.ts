import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompRegistry, StudioComposition } from "../studio/types";
import { generative } from "../generative";
import {
  compositionAssetIds,
  compositionRenderKeys,
  compositionSourcePaths,
  createHttpStudioProjectAdapter,
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

  it("remounts open previews with the refreshed asset resolver after an import", async () => {
    let imported = false;
    const project = {
      getAssets: vi.fn(async () => ({
        version: 1,
        assets: imported ? {
          fresh: {
            name: "fresh.png",
            contentHash: "sha256:fresh",
            mime: "image/png",
            bytes: 5,
            sources: ["/__framediff-cache/sha256%3Afresh"],
          },
        } : {},
      })),
      uploadAsset: vi.fn(async () => {
        imported = true;
        return "fresh";
      }),
    };
    const runtime = createStudioRuntime({ main: composition } as CompRegistry, project as never);
    type PreviewStub = { compositionKey: string; mountedKey?: string };
    const preview: PreviewStub = { compositionKey: "main", mountedKey: "main" };
    const runtimeInternals = runtime as unknown as {
      assetsReady: Promise<void>;
      previews: Set<PreviewStub>;
      renderPreview(preview: PreviewStub): void;
    };
    await runtimeInternals.assetsReady;
    const renderPreview = vi.spyOn(runtimeInternals, "renderPreview").mockImplementation(() => undefined);
    runtimeInternals.previews.add(preview);

    await expect(runtime.uploadAsset({ name: "fresh.png" } as File)).resolves.toBe("fresh");

    expect(preview.mountedKey).toBeUndefined();
    expect(renderPreview).toHaveBeenCalledWith(preview);
    expect(project.getAssets).toHaveBeenCalledTimes(2);
  });

  it("preserves imported asset references when submitting a generative composition", async () => {
    const generated = generative({
      id: "Generated",
      output: "video",
      model: "seedance-2.0",
      prompt: "Bring the portrait to life",
      refs: [{ kind: "image", src: "asset://portrait" }],
    });
    const project = {
      getAssets: vi.fn(async () => ({
        version: 1,
        assets: {
          portrait: {
            name: "portrait.png",
            contentHash: "sha256:portrait",
            mime: "image/png",
            bytes: 10,
            sources: ["/__framediff-cache/sha256%3Aportrait"],
          },
        },
      })),
      submitGeneration: vi.fn(async () => ({
        job: { id: "job-1", status: "queued" },
      })),
    };
    const runtime = createStudioRuntime({ generated } as CompRegistry, project as never);

    await expect(runtime.submitGeneration("generated")).resolves.toMatchObject({ ok: true });

    expect(project.submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      refs: [expect.objectContaining({
        kind: "image",
        src: "asset://portrait",
        authoredSrc: "asset://portrait",
      })],
    }));
  });

  it("uses an injected project adapter without replacing the browser fetch implementation", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url === "/__framediff/src?file=src%2Fcomp.ts") {
        return Response.json({ file: "src/comp.ts", text: "export const value = 1;", hash: "source:1" });
      }
      return new Response("not found", { status: 404 });
    });
    const browserFetch = vi.fn(async () => {
      throw new Error("The injected adapter must not use global fetch.");
    });
    vi.stubGlobal("fetch", browserFetch);
    const runtime = createStudioRuntime(
      { main: composition } as CompRegistry,
      createHttpStudioProjectAdapter(request),
    );

    await expect(runtime.readSource("src/comp.ts")).resolves.toBe("export const value = 1;");
    expect(request).toHaveBeenCalledWith("/__framediff/src?file=src%2Fcomp.ts");
    expect(browserFetch).not.toHaveBeenCalled();
  });

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

describe("HtmlStudioRuntime script sheets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("projects the row contract and commits a ripple as one source transaction", async () => {
    const html = `<main data-fd-composition data-fd-id="Script" data-fd-duration="60">
  <section data-fd-clip data-fd-id="a" data-fd-from="0" data-fd-duration="30">
    <h3 data-fd-id="a-title" data-fd-script-field="title">A</h3>
    <p data-fd-id="a-narration" data-fd-script-field="narration">Line</p>
    <p data-fd-id="a-visual" data-fd-script-field="visual">View</p>
    <p data-fd-id="a-sfx" data-fd-script-field="sfx">Bell</p>
    <div data-fd-clip data-fd-script-source data-fd-id="a-source" data-fd-type="nested" data-fd-comp="shot" data-fd-from="0" data-fd-duration="30"></div>
  </section>
  <section data-fd-clip data-fd-id="b" data-fd-from="30" data-fd-duration="30"></section>
</main>`;
    const script = {
      id: "Script",
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 60,
      html,
      meta: { kind: "script" as const, file: "src/Script.html", sourceFormat: "html" as const },
    } satisfies StudioComposition;
    let transaction: { label: string; files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        return Response.json({ file: "src/Script.html", text: html, hash: "script:1" });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "script-1", label: transaction!.label, before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ script } as CompRegistry);

    await expect(runtime.probeScriptSheet("script")).resolves.toMatchObject({
      rows: [{ id: "a", fields: { narration: { text: "Line" } } }, { id: "b" }],
    });
    const result = await runtime.editPlan({
      compositionKey: "script",
      type: "retime",
      rowId: "a",
      durationInFrames: 45,
    });

    expect(result.ok).toBe(true);
    expect(transaction?.label).toBe("Retime script scene");
    expect(transaction?.files).toHaveLength(1);
    expect(transaction?.files[0].text).toContain('data-fd-id="b" data-fd-from="45"');
    expect(transaction?.files[0].text).toContain('data-fd-id="Script" data-fd-duration="75"');
  });
});

describe("HtmlStudioRuntime document-backed composition duration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes a generated leaf duration editable and commits it to the bound JSON object", async () => {
    const document = { moves: [{ name: "shot", durationInFrames: 48 }] };
    const comp = {
      ...composition,
      document,
      meta: {
        ...composition.meta,
        document: {
          file: "src/Camera.comp.json",
          bindings: { shot: "/moves/0" },
          hotUpdate: "remount" as const,
        },
      },
    } satisfies StudioComposition;
    let transaction: { label: string; files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Camera.comp.json") return Response.json({ file, text: JSON.stringify(document), hash: "document:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "duration-1", label: transaction!.label, before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: comp } as CompRegistry);

    expect((await runtime.probe("main"))[0].editable?.duration).toBe(true);
    const result = await runtime.editPlacement({
      compositionKey: "main",
      itemId: "shot",
      field: "durationInFrames",
      value: 72,
    });

    expect(result.ok).toBe(true);
    expect(transaction?.label).toBe("Edit composition duration");
    expect(JSON.parse(transaction?.files[0].text ?? "{}")).toEqual({
      moves: [{ name: "shot", durationInFrames: 72 }],
    });
    expect(runtime.getCompositions()[0].durationInFrames).toBe(72);
    expect((await runtime.probe("main"))[0]).toMatchObject({ durationInFrames: 72, editable: { duration: true } });
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

  it("migrates canvas geometry into v2 JSON, edits layout, adds shapes, and swaps stacking ranks", async () => {
    let timelineText = JSON.stringify({
      version: 1,
      items: [{
        id: "shot",
        name: "Hero",
        from: 0,
        durationInFrames: 48,
        layer: 0,
        content: { type: "video", src: "asset://hero" },
      }],
    });
    const htmlText = `<!doctype html><main data-fd-composition data-fd-id="Edit" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48" data-fd-kind="edit">
  <video data-fd-clip data-fd-id="shot" data-fd-x="0" data-fd-y="0"></video>
</main>`;
    const comp = {
      ...composition,
      id: "Edit",
      html: htmlText,
      timeline: JSON.parse(timelineText),
      meta: { kind: "edit" as const, file: "src/Edit.html", sourceFormat: "html" as const, timelineFile: "src/Edit.timeline.json" },
    } satisfies StudioComposition;
    const transactions: Array<{ label: string; groupId?: string; files: Array<{ file: string; text: string }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Edit.timeline.json") return Response.json({ file, text: timelineText, hash: `timeline:${transactions.length}` });
        if (file === "src/Edit.html") return Response.json({ file, text: htmlText, hash: "html:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        const transaction = JSON.parse(String(init.body));
        transactions.push(transaction);
        timelineText = transaction.files.find((entry: { file: string }) => entry.file === "src/Edit.timeline.json")?.text ?? timelineText;
        return Response.json({ ok: true, receipt: { id: `edit-${transactions.length}`, label: transaction.label, before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: comp } as CompRegistry);
    await runtime.probe("main");

    const initialDetails = await runtime.inspectItem("main", "shot");
    expect(initialDetails.sections.find((section) => section.id === "timeline-layout")?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "timeline:layout:x", value: 0 }),
      expect.objectContaining({ id: "timeline:layout:width", value: 1920 }),
      expect.objectContaining({ id: "timeline:layout:fit", text: "cover" }),
      expect.objectContaining({ id: "timeline:layout:corner-radius", value: 0 }),
    ]));

    expect((await runtime.editElementProperties({
      compositionKey: "main",
      objectId: "shot",
      patch: { x: 120, y: 48, width: 960, height: 540 },
      label: "Resize hero",
      groupId: "layout-gesture",
    })).ok).toBe(true);
    expect(transactions.at(-1)).toMatchObject({ label: "Resize hero", groupId: "layout-gesture" });
    expect(JSON.parse(timelineText)).toMatchObject({
      version: 2,
      items: [{
        id: "shot",
        layout: {
          rect: [120, 48, 960, 540],
          fit: "cover",
          cornerRadius: 0,
          opacity: 1,
        },
      }],
    });

    expect((await runtime.editInspectorField({
      compositionKey: "main",
      itemId: "shot",
      fieldId: "timeline:layout:corner-radius",
      value: 28,
    })).ok).toBe(true);
    expect((await runtime.createTimelineShape({ compositionKey: "main", shape: "path", from: 12 })).ok).toBe(true);
    let document = JSON.parse(timelineText);
    expect(document.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "shot", layer: 0, layout: expect.objectContaining({ cornerRadius: 28 }) }),
      expect.objectContaining({
        id: "path-shape",
        from: 12,
        layer: 1,
        layout: expect.objectContaining({ fit: "fill" }),
        content: expect.objectContaining({ type: "shape", shape: "path", d: expect.any(String) }),
      }),
    ]));

    expect((await runtime.editPlacements([
      { compositionKey: "main", itemId: "shot", field: "layer", value: 1 },
    ])).ok).toBe(true);
    document = JSON.parse(timelineText);
    expect(document.items.find((item: { id: string }) => item.id === "shot").layer).toBe(1);
    expect(document.items.find((item: { id: string }) => item.id === "path-shape").layer).toBe(0);
    expect(transactions.every((transaction) => transaction.files.every((entry) => entry.file === "src/Edit.timeline.json"))).toBe(true);
    expect(runtime.getCompositions()[0]).toMatchObject({ timelineDocument: true });
  });

  it("edits media or nested audio and deletes clips or whole lanes as undoable source transactions", async () => {
    let timelineText = JSON.stringify({
      version: 1,
      items: [
        { id: "shot", from: 0, durationInFrames: 48, layer: 0, content: { type: "video", src: "asset://shot" } },
        { id: "caption", from: 0, durationInFrames: 48, layer: 0, content: { type: "layers", label: "Caption" } },
        { id: "nested", from: 0, durationInFrames: 48, layer: 1, volume: 0.5, content: { type: "nested", composition: "child" } },
        { id: "overlay", from: 0, durationInFrames: 48, layer: 2, content: { type: "layers", label: "Overlay" } },
      ],
    });
    let htmlText = `<!doctype html><main data-fd-composition data-fd-id="Edit" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48" data-fd-kind="edit">
  <section data-fd-clip data-fd-id="shot"><video></video></section>
  <section data-fd-clip data-fd-id="caption">Caption</section>
  <section data-fd-clip data-fd-id="nested" data-fd-type="nested" data-fd-comp="stale-child" data-fd-nested-scale="2" data-fd-volume="0.9">
    <section data-fd-clip data-fd-id="overlay">Overlay</section>
  </section>
</main>`;
    const comp = {
      ...composition,
      id: "Edit",
      html: htmlText,
      timeline: JSON.parse(timelineText),
      meta: { kind: "edit" as const, file: "src/Edit.html", sourceFormat: "html" as const, timelineFile: "src/Edit.timeline.json" },
    } satisfies StudioComposition;
    let transaction: { label: string; files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Edit.timeline.json") return Response.json({ file, text: timelineText, hash: `timeline:${timelineText.length}` });
        if (file === "src/Edit.html") return Response.json({ file, text: htmlText, hash: `html:${htmlText.length}` });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        for (const change of transaction!.files) {
          if (change.file === "src/Edit.timeline.json") timelineText = change.text;
          if (change.file === "src/Edit.html") htmlText = change.text;
        }
        return Response.json({ ok: true, receipt: { id: `edit-${transaction!.label}`, label: transaction!.label, before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: comp } as CompRegistry);
    await runtime.probe("main");

    const details = await runtime.inspectItem("main", "shot");
    expect(details.sections.find((section) => section.id === "timeline-media-audio")?.fields).toEqual([
      expect.objectContaining({ id: "timeline:volume", value: 1, control: expect.objectContaining({ min: 0, max: 1, slider: true }) }),
      expect.objectContaining({ id: "timeline:muted", boolean: false }),
    ]);

    expect((await runtime.editInspectorField({
      compositionKey: "main",
      itemId: "shot",
      fieldId: "timeline:volume",
      value: 0.35,
    })).ok).toBe(true);
    expect(JSON.parse(timelineText).items[0]).toMatchObject({ id: "shot", volume: 0.35 });

    const nestedDetails = await runtime.inspectItem("main", "nested");
    expect(nestedDetails.sections.find((section) => section.id === "timeline-content")).toMatchObject({
      title: "NESTED COMPOSITION",
      fields: [
        expect.objectContaining({ id: "timeline:composition", text: "child" }),
        expect.objectContaining({ id: "timeline:nested-scale", value: 1 }),
        expect.objectContaining({ id: "timeline:trim-start", value: 0 }),
        expect.objectContaining({ id: "timeline:playback-rate", value: 1 }),
      ],
    });
    expect(nestedDetails.sections.find((section) => section.id === "timeline-media-audio")).toMatchObject({
      title: "COMPOSITION AUDIO",
      fields: [
        expect.objectContaining({ id: "timeline:volume", value: 0.5 }),
        expect.objectContaining({ id: "timeline:muted", boolean: false }),
      ],
    });
    expect(nestedDetails.sections.flatMap((section) => section.fields).map((field) => field.id)).not.toEqual(
      expect.arrayContaining(["html:data-fd-comp", "html:data-fd-nested-scale", "html:data-fd-volume"]),
    );
    expect((await runtime.editInspectorField({
      compositionKey: "main",
      itemId: "nested",
      fieldId: "timeline:nested-scale",
      value: 0.75,
    })).ok).toBe(true);
    expect((await runtime.editInspectorField({
      compositionKey: "main",
      itemId: "nested",
      fieldId: "timeline:muted",
      value: true,
    })).ok).toBe(true);
    expect(JSON.parse(timelineText).items.find((item: { id: string }) => item.id === "nested")).toMatchObject({
      id: "nested",
      volume: 0.5,
      muted: true,
      content: expect.objectContaining({ nestedScale: 0.75 }),
    });

    const deleted = await runtime.deleteTimelineItems({
      compositionKey: "main",
      itemIds: ["shot", "caption"],
      compactLayer: { kind: "video", layer: 0 },
    });
    expect(deleted.ok).toBe(true);
    expect(transaction?.label).toBe("Delete video layer 1");
    expect(transaction?.files.map((file) => file.file)).toEqual(["src/Edit.timeline.json", "src/Edit.html"]);
    expect(JSON.parse(timelineText).items).toEqual([
      expect.objectContaining({ id: "nested", layer: 0 }),
      expect.objectContaining({ id: "overlay", layer: 1 }),
    ]);
    expect(htmlText).not.toContain('data-fd-id="shot"');
    expect(htmlText).not.toContain('data-fd-id="caption"');
    expect(htmlText).toContain('data-fd-id="nested"');
    expect(htmlText).toContain('data-fd-id="overlay"');
    expect((await runtime.probe("main")).map((item) => item.id)).toEqual(["nested", "overlay"]);

    const unsafe = await runtime.deleteTimelineItems({
      compositionKey: "main",
      itemIds: ["nested"],
    });
    expect(unsafe).toMatchObject({
      ok: false,
      file: "src/Edit.html",
      message: expect.stringContaining("would also remove timeline item overlay"),
    });
    expect(JSON.parse(timelineText).items.map((item: { id: string }) => item.id)).toEqual(["nested", "overlay"]);
    expect(htmlText).toContain('data-fd-id="nested"');
    expect(htmlText).toContain('data-fd-id="overlay"');
  });

  it("nests a dropped composition by editing only the JSON timeline document", async () => {
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
    expect(transaction?.files.map((file) => file.file)).toEqual(["src/Main.timeline.json"]);
    expect(JSON.parse(transaction?.files[0].text ?? "{}")).toEqual({
      version: 2,
      items: [{
        id: "nested-title",
        name: "Title",
        from: 36,
        durationInFrames: 48,
        layer: 0,
        layout: { rect: [0, 0, 1920, 1080], fit: "cover", cornerRadius: 0, opacity: 1 },
        content: { type: "nested", composition: "title" },
      }],
    });
  });
});

describe("HtmlStudioRuntime generative recipe documents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes mutable recipe settings and comp refs to JSON without rewriting TypeScript", async () => {
    const data = { provider: "fal" as const, model: "seedance-2.0", prompt: "Original", refs: [{ kind: "video" as const, src: "comp://input" }], take: 0 };
    const generated = generative({ id: "Generated", file: "src/Generated.gen.ts", dataFile: "src/Generated.gen.json", ...data });
    let transaction: { files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Generated.gen.json") return Response.json({ file, text: JSON.stringify(data), hash: "gen-data:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "edit-gen", label: "Edit generative recipe", before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ generated } as CompRegistry);

    const result = await runtime.updateGenerativeRecipe("generated", { prompt: "JSON only", refs: [{ kind: "video", src: "comp://new-input" }] });

    expect(result.ok).toBe(true);
    expect(transaction?.files).toHaveLength(1);
    expect(transaction?.files[0].file).toBe("src/Generated.gen.json");
    expect(JSON.parse(transaction?.files[0].text ?? "{}")).toMatchObject({
      output: "video",
      prompt: "JSON only",
      refs: [{ kind: "video", src: "comp://new-input" }],
    });
  });

  it("rejects changing either the locked output or a model from another media type", async () => {
    const data = { provider: "fal" as const, output: "video" as const, model: "seedance-2.0", prompt: "Original", refs: [], take: 0 };
    const generated = generative({ id: "Generated", file: "src/Generated.gen.ts", dataFile: "src/Generated.gen.json", ...data });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        return Response.json({ file: "src/Generated.gen.json", text: JSON.stringify(data), hash: "gen-data:1" });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ generated } as CompRegistry);

    await expect(runtime.updateGenerativeRecipe("generated", { output: "image" })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("locked to video"),
    });
    await expect(runtime.updateGenerativeRecipe("generated", { model: "seedream-5.0-pro" })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("produces image"),
    });
  });

  it("reports only same-type models and classifies composition input geometry", async () => {
    const generated = generative({
      id: "Generated",
      output: "video",
      model: "seedance-2.0",
      prompt: "Animate the portrait",
      resolution: "720p",
      aspect: "16:9",
      refs: [{ kind: "image", src: "comp://portrait" }],
    });
    const portrait = {
      ...composition,
      id: "Portrait",
      width: 1152,
      height: 1536,
      meta: { ...composition.meta, output: "image" as const },
    } satisfies StudioComposition;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/__framediff/assets") return Response.json({ assets: {} });
      if (url === "/__framediff/secrets") return Response.json({ providers: { fal: { set: true } } });
      if (url.startsWith("/__framediff/gen/jobs?")) return Response.json({ jobs: [], takes: [] });
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ generated, portrait } as CompRegistry);

    const workspace = await runtime.getGenerativeWorkspace("generated");

    expect(workspace).toMatchObject({
      outputKind: "video",
      nativeWidth: 1280,
      nativeHeight: 720,
      refs: [{
        sourceWidth: 1152,
        sourceHeight: 1536,
        targetWidth: 1280,
        targetHeight: 720,
        geometry: {
          relation: "mixed",
          allowedFits: ["cover", "contain", "stretch"],
        },
      }],
      compositions: [{ key: "portrait", width: 1152, height: 1536 }],
    });
    expect(workspace?.models.length).toBeGreaterThan(3);
    expect(workspace?.models.map((model) => model.id)).not.toContain("seedream-5.0-pro");
    expect(workspace?.models.map((model) => model.id)).not.toContain("seed-audio-1.0");
  });

  it("starts a new draft from the saved recipe and inputs of a failed take", async () => {
    const data = { provider: "fal" as const, model: "seedance-2.0", prompt: "Current", refs: [], take: 0 };
    const generated = generative({ id: "Generated", file: "src/Generated.gen.ts", dataFile: "src/Generated.gen.json", ...data });
    let transaction: { files: Array<{ file: string; text: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/gen/jobs?gen=Generated") {
        return Response.json({
          jobs: [{
            id: "failed-job",
            gen: "Generated",
            endpoint: "provider/model",
            recipeHash: "sha256:failed",
            status: "failed",
            take: 1,
            at: "2026-07-23T00:00:00.000Z",
            recipe: {
              provider: "fal",
              model: "seedance-2.0",
              prompt: "Failed recipe",
              refs: [{ kind: "image", src: "comp://portrait" }],
            },
            inputs: [{ kind: "image", src: "comp://portrait", contentHash: "sha256:portrait" }],
          }],
          takes: [],
        });
      }
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Generated.gen.json") return Response.json({ file, text: JSON.stringify(data), hash: "gen-data:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        return Response.json({ ok: true, receipt: { id: "failed-draft", label: "Start draft from failed take 1", before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ generated } as CompRegistry);

    const result = await runtime.startGenerationFromJob("generated", "failed-job");

    expect(result.ok).toBe(true);
    expect(transaction?.files).toHaveLength(1);
    expect(JSON.parse(transaction?.files[0].text ?? "{}")).toMatchObject({
      prompt: "Failed recipe",
      refs: [{ kind: "image", src: "/__framediff-cache/sha256%3Aportrait" }],
      take: 0,
    });
  });
});

describe("HtmlStudioRuntime composition documents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("commits a JSON-backed XYZ gesture as one atomic document edit", async () => {
    const document = { moves: [{ name: "shot", startCameraX: -0.66, startCameraY: 0, startCameraZ: 2.8 }] };
    const comp = {
      ...composition,
      document,
      meta: {
        ...composition.meta,
        document: { file: "src/Camera.comp.json", bindings: { shot: "/moves/0" }, hotUpdate: "remount" as const },
      },
    } satisfies StudioComposition;
    let transaction: { label: string; groupId?: string; files: Array<{ file: string; text: string }> } | undefined;
    let documentText = JSON.stringify(document);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__framediff/assets") return new Response("missing", { status: 404 });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        if (file === "src/Camera.comp.json") return Response.json({ file, text: documentText, hash: "document:1" });
        return new Response("missing", { status: 404 });
      }
      if (url === "/__framediff/edit" && init?.method === "POST") {
        transaction = JSON.parse(String(init.body));
        documentText = transaction!.files[0].text;
        return Response.json({ ok: true, receipt: { id: "move-camera", label: transaction!.label, before: [], after: [] } });
      }
      return new Response("not found", { status: 404 });
    }));
    const runtime = createStudioRuntime({ main: comp } as CompRegistry);
    const compositionUpdates = vi.fn();
    runtime.subscribeCompositions(compositionUpdates);
    const details = await runtime.inspectItem("main", "shot");
    const fields = new Map(details.sections[0].fields.map((field) => [field.label, field]));

    const result = await runtime.editInspectorFields({
      compositionKey: "main",
      itemId: "shot",
      edits: [
        { fieldId: fields.get("Start Camera X")!.id, value: -0.25 },
        { fieldId: fields.get("Start Camera Y")!.id, value: 0.4 },
        { fieldId: fields.get("Start Camera Z")!.id, value: 3.1 },
      ],
      label: "Move start camera",
      groupId: "camera-gesture-1",
    });

    expect(result.ok).toBe(true);
    expect(transaction).toMatchObject({ label: "Move start camera", groupId: "camera-gesture-1" });
    expect(transaction?.files).toHaveLength(1);
    expect(transaction?.files[0].file).toBe("src/Camera.comp.json");
    expect(compositionUpdates).toHaveBeenCalledOnce();
    expect(JSON.parse(transaction?.files[0].text ?? "{}")).toMatchObject({
      moves: [{ startCameraX: -0.25, startCameraY: 0.4, startCameraZ: 3.1 }],
    });
    const updatedDetails = await runtime.inspectItem("main", "shot");
    expect(Object.fromEntries(updatedDetails.sections[0].fields.map((field) => [field.label, field.value]))).toMatchObject({
      "Start Camera X": -0.25,
      "Start Camera Y": 0.4,
      "Start Camera Z": 3.1,
    });
  });

  it("projects bound JSON Schema properties and edits JSON without rewriting composition code", async () => {
    const document = { params: { strength: 2.5, tint: "#ff00aa", enabled: true }, motion: { drift: 24 } };
    const schema = { type: "object", properties: {
      params: { type: "object", properties: {
        strength: { type: "number", minimum: 0, maximum: 8 },
        tint: { type: "string", format: "color" },
        enabled: { type: "boolean" },
      } },
      motion: { type: "object", properties: { drift: { type: "number", minimum: 0, maximum: 120 } } },
    } };
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
    const compositionDetails = await runtime.inspectItem("main", "CameraComp");
    expect(compositionDetails.sections[0]).toMatchObject({ title: "COMPOSITION PROPERTIES" });
    expect(compositionDetails.sections[0].fields.map((field) => field.label)).toEqual(["Drift"]);
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
      html: '<main data-fd-composition data-fd-id="Parent" data-fd-width="1920" data-fd-height="1080" data-fd-fps="24" data-fd-duration="48"></main>',
      timeline: { version: 1 as const, items: [{ id: "leaf", from: 0, durationInFrames: 48, content: { type: "nested" as const, composition: "leaf" } }] },
      meta: { file: "src/Parent.html", module: "src/Parent.ts", timelineFile: "src/Parent.timeline.json" },
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
      "src/Parent.timeline.json",
      "src/Leaf.html",
      "src/Leaf.ts",
      "src/Leaf.comp.json",
    ]);
    expect(compositionSourcePaths(registry, "parent")).not.toContain("src/Leaf.schema.json");
    expect(compositionSourcePaths(registry, "parent")).not.toContain("src/Unrelated.comp.json");
    expect(compositionSourcePaths(registry, "unrelated")).toEqual(["src/Unrelated.html", "src/Unrelated.comp.json"]);
  });

  it("resolves generative comp refs by registry key or composition ID", () => {
    const leaf = {
      ...composition,
      id: "LeafDisplayId",
      meta: { file: "src/Leaf.html", document: { file: "src/Leaf.comp.json" } },
    } satisfies StudioComposition;
    const generated = generative({
      id: "Generated",
      file: "src/Generated.gen.ts",
      dataFile: "src/Generated.gen.json",
      prompt: "Use the leaf",
      refs: [{ kind: "video", src: "comp://LeafDisplayId" }],
    });
    const registry = { generated, "leaf-key": leaf } satisfies CompRegistry;

    expect(compositionRenderKeys(registry, "generated")).toEqual(["generated", "leaf-key"]);
    expect(compositionSourcePaths(registry, "generated")).toEqual([
      "src/Generated.gen.ts",
      "src/Generated.gen.json",
      "src/Leaf.html",
      "src/Leaf.comp.json",
    ]);
  });

  it("tracks asset content dependencies through the complete composition tree", () => {
    const leaf = {
      ...composition,
      id: "Leaf",
      timeline: { version: 1 as const, items: [{
        id: "plate", from: 0, durationInFrames: 48,
        content: { type: "video" as const, src: "asset://plate" },
      }] },
    } satisfies StudioComposition;
    const parent = {
      ...composition,
      id: "Parent",
      timeline: { version: 1 as const, items: [{
        id: "leaf", from: 0, durationInFrames: 48,
        content: { type: "nested" as const, composition: "leaf" },
      }] },
    } satisfies StudioComposition;

    expect(compositionAssetIds({ parent, leaf }, "parent")).toEqual(["plate"]);
  });

  it("uses fresh source, runtime, and asset hashes from one authoritative bake-input API", async () => {
    let plateHash = "sha256:plate-v1";
    const assetComp = {
      ...composition,
      meta: { file: "src/comp.ts", sourceFormat: "generated" as const },
      timeline: { version: 1 as const, items: [{
        id: "plate", from: 0, durationInFrames: 48,
        content: { type: "video" as const, src: "asset://plate" },
      }] },
    } satisfies StudioComposition;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/__framediff/assets") return Response.json({
        version: 1,
        assets: { plate: { name: "Plate", contentHash: plateHash, mime: "video/mp4", bytes: 10, sources: [] } },
      });
      if (url.startsWith("/__framediff/src?")) {
        const file = new URL(url, "http://local").searchParams.get("file")!;
        return file === "src/comp.ts" ? Response.json({ file, text: "export const version = 1;", hash: "unused" }) : new Response("missing", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    }));
    try {
      const runtime = createStudioRuntime({ camera: assetComp });
      const first = await runtime.getCompositionBakeInputs("camera");
      expect(first.missing).toEqual([]);
      expect(first.inputs).toMatchObject({
        "framediff://output-kind": expect.stringMatching(/^sha256:/),
        "src/comp.ts": expect.stringMatching(/^sha256:/),
        "composition://camera": expect.stringMatching(/^sha256:/),
        "asset://plate": "sha256:plate-v1",
      });

      plateHash = "sha256:plate-v2";
      expect((await runtime.getCompositionBakeInputs("camera")).inputs["asset://plate"]).toBe("sha256:plate-v2");
      expect((await runtime.getCompositionBakeInputs("camera", "image")).inputs["framediff://output-kind"])
        .not.toBe(first.inputs["framediff://output-kind"]);
    } finally {
      vi.unstubAllGlobals();
    }
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
      outputKind: "video",
    }, "main");

    expect(result).toMatchObject({ ok: true, compositionKey: "new-shot" });
    expect(sources["src/NewShot.gen.ts"]).toContain('import { generative, type GenRecipeData } from "framediff";');
    expect(sources["src/NewShot.gen.ts"]).toContain("export const newShotComp = generative({");
    expect(sources["src/NewShot.gen.ts"]).toContain('file: "src/NewShot.gen.ts"');
    expect(sources["src/NewShot.gen.ts"]).toContain('dataFile: "src/NewShot.gen.json"');
    expect(JSON.parse(sources["src/NewShot.gen.json"])).toMatchObject({
      output: "video",
      model: "seedance-2.0",
      duration: 5,
      aspect: "16:9",
      take: 0,
    });
    expect(sources["src/NewShot.html"]).toBeUndefined();
    expect(sources["src/config.ts"]).toContain('import { newShotComp } from "./NewShot.gen";');
    expect(sources["src/config.ts"]).toContain('{ main: composition, "new-shot": newShotComp, }');
    expect(sources["src/Main.html"]).toContain('data-fd-name="NewShot"');
    expect(sources["src/Main.html"]).toContain('data-fd-type="nested" data-fd-comp="NewShot"');
    expect(result.message).toContain("nested it under Main");

    await expect(runtime.createComposition({
      name: "Poster Frame",
      kind: "generate",
      durationInFrames: 1,
      outputKind: "image",
    }, "main")).resolves.toMatchObject({ ok: true, compositionKey: "poster-frame" });
    expect(JSON.parse(sources["src/PosterFrame.gen.json"])).toMatchObject({
      output: "image",
      model: "seedream-5.0-pro",
      take: 0,
    });

    await expect(runtime.createComposition({
      name: "Dialogue Track",
      kind: "generate",
      durationInFrames: 120,
      outputKind: "audio",
    }, "main")).resolves.toMatchObject({ ok: true, compositionKey: "dialogue-track" });
    expect(JSON.parse(sources["src/DialogueTrack.gen.json"])).toMatchObject({
      output: "audio",
      model: "seed-audio-1.0",
      duration: 5,
      take: 0,
    });
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

    const custom = await runtime.createComposition({
      name: "Frame Logic",
      kind: "custom",
      durationInFrames: 72,
    }, "");

    expect(custom).toMatchObject({ ok: true, compositionKey: "frame-logic" });
    expect(sources["src/FrameLogic.html"]).toContain('data-fd-kind="custom"');
    expect(sources["src/FrameLogic.html"]).toContain('data-fd-timeline="hidden" data-fd-transport="always"');
    expect(sources["src/FrameLogic.html"]).toContain("onFrame(({ frame, time, playing, fps, durationInFrames }) =>");
    expect(sources["src/FrameLogic.html"]).toContain('data-fd-comp="its-registry-key"');
    expect(sources["src/FrameLogic.ts"]).toContain("defineComposition(source)");
    expect(sources["src/FrameLogic.ts"]).not.toContain("import document");
    expect(sources["src/FrameLogic.comp.json"]).toBeUndefined();
    expect(sources["src/FrameLogic.schema.json"]).toBeUndefined();
    expect(sources["src/FrameLogic.timeline.json"]).toBeUndefined();
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
