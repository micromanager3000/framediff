import { describe, expect, it } from "vitest";
import { defineComposition } from "../composition";
import { findHtmlElementById, inspectorFieldsFromHtml, removeHtmlElement, rewriteHtmlAttribute, rewriteHtmlAttributes, timelineFromComposition, timelineFromHtml } from "./htmlSource";

const HTML = `<!doctype html>
<html><head><style>.title { color: white }</style></head><body>
  <main data-fd-composition data-fd-id="Demo" data-fd-width="1920" data-fd-height="1080" data-fd-fps="30" data-fd-duration="90" data-fd-kind="edit" data-fd-data-mode="source">
    <section data-fd-clip data-fd-id="hero" data-fd-name="Hero" data-fd-from="-5" data-fd-duration="45" data-fd-x="12">
      <video data-fd-id="hero-media" data-fd-src="asset://hero" data-fd-trim-start="1.5"></video>
    </section>
    <div data-fd-clip data-fd-id='title' data-fd-from="30" data-fd-duration="30" data-fd-text="Hello"></div>
  </main>
</body></html>`;

describe("HTML composition source", () => {
  it("defines metadata and timeline clips from one document", () => {
    const comp = defineComposition(HTML, { file: "src/Demo.html" });
    expect(comp).toMatchObject({ id: "Demo", width: 1920, height: 1080, fps: 30, durationInFrames: 90 });
    expect(timelineFromHtml(comp)).toMatchObject([
      { id: "hero", from: -5, durationInFrames: 45, name: "Hero", content: { type: "video", src: "asset://hero", trimStart: 1.5 } },
      { id: "title", from: 30, durationInFrames: 30, content: { type: "layers", label: "title" } },
    ]);
  });

  it("reads composition-owned authoring overrides independently", () => {
    const source = HTML.replace(
      "data-fd-kind=\"edit\"",
      "data-fd-kind=\"scene\" data-fd-timeline=\"hidden\" data-fd-transport=\"hidden\" data-fd-direct-manipulation=\"false\"",
    );
    const composition = defineComposition(source);
    expect(composition.definition.kind).toBe("scene");
    expect(composition.meta).toMatchObject({
      authoring: { timeline: "hidden", transport: "hidden", directManipulation: false },
    });
  });

  it("keeps edit placement data in an external timeline document", () => {
    const comp = defineComposition(HTML, {
      file: "src/Demo.html",
      timeline: {
        version: 1,
        items: [
          { id: "hero", from: 12, durationInFrames: 72, layer: 2, trimStart: -0.5, volume: 0.35, muted: true },
          { id: "title", from: 48, durationInFrames: 20, layer: 3 },
        ],
      },
      meta: { timelineFile: "src/Demo.timeline.json" },
    });

    expect(timelineFromComposition(comp)).toMatchObject([
      { id: "hero", from: 12, durationInFrames: 72, layer: 2, content: { trimStart: -0.5, volume: 0.35, muted: true }, editable: { delete: true } },
      { id: "title", from: 48, durationInFrames: 20, layer: 3 },
    ]);
    expect(comp.meta?.timelineFile).toBe("src/Demo.timeline.json");
  });

  it("projects a complete nested layer from JSON without an HTML placeholder", () => {
    const comp = defineComposition(HTML.replace(/<section[\s\S]*?<\/section>/, ""), {
      timeline: {
        version: 1,
        items: [{
          id: "nested-title",
          name: "Title",
          from: 8,
          durationInFrames: 42,
          volume: 0.25,
          muted: true,
          content: { type: "nested", composition: "title-card" },
        }],
      },
    });
    expect(timelineFromComposition(comp).find((item) => item.id === "nested-title")).toMatchObject({
      id: "nested-title",
      name: "Title",
      from: 8,
      durationInFrames: 42,
      content: { type: "nested", compId: "title-card", volume: 0.25, muted: true },
    });
  });

  it("projects JSON-authored image and shape layers without HTML placeholders", () => {
    const comp = defineComposition(HTML, {
      timeline: {
        version: 2,
        items: [
          {
            id: "reference",
            from: 0,
            durationInFrames: 90,
            layer: 0,
            layout: { rect: [40, 40, 800, 450], fit: "contain" },
            content: { type: "image", src: "asset://reference" },
          },
          {
            id: "accent",
            from: 12,
            durationInFrames: 60,
            layer: 1,
            layout: { rect: [100, 700, 600, 80], fit: "fill" },
            content: { type: "shape", shape: "line", stroke: "#ffffff", strokeWidth: 6 },
          },
        ],
      },
    });
    expect(timelineFromComposition(comp)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reference", layer: 0, content: { type: "image", src: "asset://reference" } }),
      expect.objectContaining({ id: "accent", layer: 1, content: { type: "shape", shape: "line" } }),
    ]));
  });

  it("rewrites existing values and inserts defaulted placement attributes", () => {
    expect(rewriteHtmlAttribute(HTML, "hero", "data-fd-from", 12)).toContain('data-fd-from="12"');
    const withoutDuration = HTML.replace(' data-fd-duration="30" data-fd-text', " data-fd-text");
    expect(rewriteHtmlAttribute(withoutDuration, "title", "data-fd-duration", 60)).toContain('data-fd-duration="60"');
  });

  it("materializes default video audio controls and removes only the selected layer", () => {
    const fields = inspectorFieldsFromHtml(HTML, "hero");
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "html:data-fd-volume", value: 1, control: expect.objectContaining({ min: 0, max: 1, slider: true }) }),
      expect.objectContaining({ id: "html:data-fd-muted", boolean: false }),
    ]));
    const removed = removeHtmlElement(HTML, "hero");
    expect(removed).not.toContain('data-fd-id="hero"');
    expect(removed).toContain("data-fd-id='title'");
    expect(removed).toContain("data-fd-composition");
  });

  it("materializes move and resize properties together", () => {
    const rewritten = rewriteHtmlAttributes(HTML, "title", {
      "data-fd-x": 24,
      "data-fd-y": -12,
      "data-fd-width": 640,
      "data-fd-height": 180,
    });
    expect(rewritten).toContain('data-fd-x="24" data-fd-y="-12" data-fd-width="640" data-fd-height="180"');
  });

  it("exposes standard and custom inspector properties", () => {
    const source = HTML.replace('data-fd-x="12"', 'data-fd-x="12" data-fd-opacity="0.75" data-fd-color="#ab42ff" data-fd-font-family="Inter" data-fd-text-align="center" data-fd-prop-wobble="0.25" data-fd-prop-wobble-label="Wobble"');
    expect(inspectorFieldsFromHtml(source, "hero")).toEqual(expect.arrayContaining([
      expect.objectContaining({ attribute: "data-fd-x", value: 12, editable: true }),
      expect.objectContaining({ attribute: "data-fd-opacity", control: expect.objectContaining({ type: "number", value: 0.75, min: 0, max: 1, step: 0.01, slider: true }) }),
      expect.objectContaining({ attribute: "data-fd-color", control: { type: "color", value: "#ab42ff" } }),
      expect.objectContaining({ attribute: "data-fd-font-family", control: expect.objectContaining({ type: "font", value: "Inter" }) }),
      expect.objectContaining({ attribute: "data-fd-text-align", control: expect.objectContaining({ type: "alignment", value: "center" }) }),
      expect.objectContaining({ attribute: "data-fd-prop-wobble", label: "Wobble", value: 0.25, editable: true }),
    ]));
    expect(findHtmlElementById(source, "hero")?.tagName).toBe("section");
  });

  it("offers stable literal leaf text as a materializable Inspector field", () => {
    const source = HTML.replace(
      "</section>",
      '<strong data-fd-id="literal-title">Hello &amp; welcome</strong><output data-fd-id="frame-count" data-fd-text-authority="computed">0f</output></section>',
    );
    const fields = inspectorFieldsFromHtml(source, "hero");

    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "html-target:literal-title:data-fd-text",
        targetId: "literal-title",
        text: "Hello & welcome",
        source: "literal text · materializes data-fd-text on edit",
      }),
    ]));
    expect(fields).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "frame-count", attribute: "data-fd-text" }),
    ]));
    expect(rewriteHtmlAttribute(source, "literal-title", "data-fd-text", "A new title")).toContain(
      '<strong data-fd-id="literal-title" data-fd-text="A new title">Hello &amp; welcome</strong>',
    );
  });

  it("targets stable descendant properties without rewriting the whole clip", () => {
    const fields = inspectorFieldsFromHtml(HTML, "hero");
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "html-target:hero-media:data-fd-src", targetId: "hero-media", text: "asset://hero" }),
      expect.objectContaining({ id: "html-target:hero-media:data-fd-trim-start", targetId: "hero-media", value: 1.5 }),
    ]));
  });

  it("keeps same-named custom properties on different descendants independently editable", () => {
    const source = HTML.replace(
      '<video data-fd-id="hero-media" data-fd-src="asset://hero" data-fd-trim-start="1.5"></video>',
      '<canvas data-fd-id="near-plane" data-fd-prop-intensity="0.3"></canvas><canvas data-fd-id="far-plane" data-fd-prop-intensity="0.8"></canvas>',
    );
    expect(inspectorFieldsFromHtml(source, "hero")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "html-target:near-plane:data-fd-prop-intensity", targetId: "near-plane", value: 0.3 }),
      expect.objectContaining({ id: "html-target:far-plane:data-fd-prop-intensity", targetId: "far-plane", value: 0.8 }),
    ]));
  });

  it("recognizes a WebGPU grade canvas as video content", () => {
    const comp = defineComposition(HTML.replace(
      '<video data-fd-id="hero-media" data-fd-src="asset://hero" data-fd-trim-start="1.5"></video>',
      '<canvas data-fd-grade-video></canvas>',
    ).replace('data-fd-x="12"', 'data-fd-x="12" data-fd-src="asset://graded" data-fd-grade-exposure="0.2"'));
    expect(timelineFromHtml(comp)[0].content).toMatchObject({ type: "video", src: "asset://graded" });
  });

  it("exposes a named composition-wide audio bed as an editable timeline item", () => {
    const source = HTML.replace(
      "</main>",
      '<audio data-fd-id="music-bed" data-fd-name="Music bed" data-fd-type="audio" data-fd-src="/music.m4a" data-fd-volume="0.5"></audio></main>',
    );
    const timeline = timelineFromHtml(defineComposition(source));
    const item = timeline.find((candidate) => candidate.id === "music-bed");
    expect(item).toMatchObject({
      from: 0,
      durationInFrames: 90,
      name: "Music bed",
      content: { type: "audio", src: "/music.m4a" },
      editable: { from: true, duration: true },
    });
    expect(inspectorFieldsFromHtml(source, "music-bed")).toEqual(expect.arrayContaining([
      expect.objectContaining({ attribute: "data-fd-src", text: "/music.m4a", editable: true }),
      expect.objectContaining({ attribute: "data-fd-volume", value: 0.5, editable: true }),
    ]));
  });

  it("ignores tag-like JavaScript and CSS while scanning authored elements", () => {
    const source = HTML.replace("</main>", '<script>onFrame(({frame}) => { if (frame < 10) query("h1").innerHTML = "<b>Hi</b>"; });</script></main>');
    const comp = defineComposition(source);
    expect(timelineFromHtml(comp).map((item) => item.id)).toEqual(["hero", "title"]);
  });
});
