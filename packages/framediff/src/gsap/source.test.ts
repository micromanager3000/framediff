import { describe, expect, it } from "vitest";
import { analyzeGsapSource, analyzeGsapUnrollGroups, ensureGsapTimelineSource, insertGsapTweenSource, rewriteGsapAnimationSource, rewriteGsapMotionPathSource, rewriteGsapUnrollSource } from "./source";

describe("GSAP registered-source analyzer", () => {
  it("projects literal fromTo and set calls into frame-native bindings", () => {
    const analysis = analyzeGsapSource(`
      import { defineGsapTimeline } from "framediff/gsap";
      export const setup = defineGsapTimeline(({ gsap, frames }) => {
        const timeline = gsap.timeline({ paused: true });
        timeline.fromTo(
          '[data-fd-id="title"]',
          { x: 0, opacity: 0 },
          { id: "title-enter", x: 320, opacity: 1, duration: frames(30), ease: "power2.out" },
          frames(10),
        );
        timeline.set('[data-fd-id="badge"]', { id: "badge-visible", opacity: 1 }, frames(42));
        return timeline;
      });
    `, { fps: 30, file: "src/GsapLab.ts" });

    expect(analysis.registered).toBe(true);
    expect(analysis.opaqueCallCount).toBe(0);
    expect(analysis.operations).toHaveLength(2);
    expect(analysis.operations[0]).toMatchObject({
      id: "title-enter",
      target: '[data-fd-id="title"]',
      kind: "fromTo",
      startFrame: 10,
      durationInFrames: 30,
      ease: "power2.out",
      editable: true,
      authority: "literal",
      start: { authority: "frames" },
      duration: { authority: "frames" },
      bindings: {
        x: { kind: "keyframes", keys: [{ frame: 10, value: 0 }, { frame: 40, value: 320, ease: "power2.out" }] },
      },
    });
    expect(analysis.operations[1]).toMatchObject({ id: "badge-visible", kind: "set", startFrame: 42, durationInFrames: 0, editable: true });
  });

  it("recognizes numeric seconds but protects them from accidental frame rewrites", () => {
    const analysis = analyzeGsapSource(`
      defineGsapTimeline(({ gsap }) => {
        const tl = gsap.timeline();
        tl.fromTo(".card", { y: 20 }, { id: "card", y: 0, duration: 0.5 }, 0.25);
        return tl;
      });
    `, { fps: 24 });
    expect(analysis.operations[0]).toMatchObject({
      startFrame: 6,
      durationInFrames: 12,
      editable: false,
      start: { authority: "seconds" },
      duration: { authority: "seconds" },
    });
  });

  it("keeps dynamic calls opaque and diagnoses nondeterministic APIs", () => {
    const analysis = analyzeGsapSource(`
      defineGsapTimeline(({ gsap }) => {
        const tl = gsap.timeline({ paused: true });
        const destination = Math.random() * 100;
        tl.to(target(), { x: destination });
        tl.call(() => sendAnalytics());
        return tl;
      });
    `, { fps: 30 });
    expect(analysis.operations).toHaveLength(0);
    expect(analysis.opaqueCallCount).toBe(2);
    expect(analysis.diagnostics.some((entry) => entry.code === "nondeterministic")).toBe(true);
  });

  it("reports syntax errors without executing source", () => {
    const analysis = analyzeGsapSource("defineGsapTimeline(() => {", { fps: 30 });
    expect(analysis.registered).toBe(false);
    expect(analysis.diagnostics[0]).toMatchObject({ code: "parse", severity: "error" });
  });

  it("round-trips timing and arbitrary keys through canonical frame-authored source", () => {
    const source = `defineGsapTimeline(({ gsap, frames }) => {
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo(".title", { x: 0 }, { id: "move", x: 100, duration: frames(20), ease: "power2.out" }, frames(10));
      return timeline;
    });`;
    const added = rewriteGsapAnimationSource(source, {
      fps: 30,
      animationId: "move",
      mutation: { type: "upsert-key", property: "x", frame: 20, value: 42, ease: "sine.inOut" },
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const analysis = analyzeGsapSource(added.text, { fps: 30 });
    expect(analysis.operations[0].bindings.x).toEqual({
      kind: "keyframes",
      keys: [
        { frame: 10, value: 0 },
        { frame: 20, value: 42, ease: "sine.inOut" },
        { frame: 30, value: 100, ease: "power2.out" },
      ],
    });
    const retimed = rewriteGsapAnimationSource(added.text, {
      fps: 30,
      animationId: "move",
      mutation: { type: "timing", startFrame: 5, durationInFrames: 40 },
    });
    expect(retimed.ok).toBe(true);
    if (retimed.ok) expect(analyzeGsapSource(retimed.text, { fps: 30 }).operations[0]).toMatchObject({ startFrame: 5, durationInFrames: 40, editable: true });
  });

  it("inserts a new stable tween before the registered return", () => {
    const source = `defineGsapTimeline(({ gsap, frames }) => {
      const timeline = gsap.timeline({ paused: true });
      return timeline;
    });`;
    const result = insertGsapTweenSource(source, {
      fps: 30,
      id: "card-x",
      target: '[data-fd-id="card"]',
      property: "x",
      from: 0,
      to: 120,
      startFrame: 12,
      durationInFrames: 30,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(analyzeGsapSource(result.text, { fps: 30 }).operations[0]).toMatchObject({ id: "card-x", startFrame: 12, durationInFrames: 30 });
  });

  it("creates and attaches a registered timeline when an authored comp records its first motion", () => {
    const source = `import { defineComposition } from "framediff";
import document from "./Card.comp.json";
import html from "./Card.html?raw";

export const cardComp = defineComposition(html, { document, meta: { document: { file: "src/Card.comp.json" } } });`;
    const prepared = ensureGsapTimelineSource(source, { fps: 30, file: "src/Card.ts", exportName: "cardComp" });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.text).toContain('import { defineGsapTimeline } from "framediff/gsap";');
    expect(prepared.text).toContain("setup: framediffRecordedMotionSetup");
    expect(analyzeGsapSource(prepared.text, { fps: 30, file: "src/Card.ts" }).registered).toBe(true);
    const inserted = insertGsapTweenSource(prepared.text, {
      fps: 30,
      file: "src/Card.ts",
      id: "card-motion-path",
      target: '[data-fd-id="card"]',
      property: "x",
      from: 20,
      to: 180,
      startFrame: 4,
      durationInFrames: 40,
      ease: "none",
    });
    expect(inserted.ok).toBe(true);
    if (inserted.ok) expect(analyzeGsapSource(inserted.text, { fps: 30 }).operations[0]).toMatchObject({
      id: "card-motion-path",
      startFrame: 4,
      durationInFrames: 40,
    });
  });

  it("combines recorded motion with an existing composition setup", () => {
    const source = `import { defineComposition } from "framediff";
const existingSetup = () => undefined;
export const cardComp = defineComposition("<main></main>", { setup: existingSetup });`;
    const prepared = ensureGsapTimelineSource(source, { fps: 24, exportName: "cardComp" });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.text).toContain('import { combineCompositionSetups } from "framediff";');
    expect(prepared.text).toContain("setup: combineCompositionSetups(existingSetup, framediffRecordedMotionSetup)");
  });

  it("attaches motion to the requested export in a shared composition module", () => {
    const source = `import { defineComposition } from "framediff";
export const firstComp = defineComposition(firstSource);
export const secondComp = defineComposition(secondSource, { document });`;
    const prepared = ensureGsapTimelineSource(source, { fps: 30, exportName: "secondComp" });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.text).toContain("defineComposition(firstSource)");
    expect(prepared.text).toContain("defineComposition(secondSource, { setup: framediffRecordedMotionSetup, document })");
  });

  it("converts position keys to an editable cubic motion path", () => {
    const source = `defineGsapTimeline(({ gsap, frames }) => {
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo(".product", { x: 0, y: 20 }, { id: "product-path", x: 200, y: 80, duration: frames(40), ease: "power2.out" }, frames(10));
      return timeline;
    });`;
    const result = rewriteGsapMotionPathSource(source, {
      fps: 30,
      animationId: "product-path",
      path: "M0,20 C40,-30 160,130 200,80",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const animation = analyzeGsapSource(result.text, { fps: 30 }).operations[0];
    expect(animation).toMatchObject({
      id: "product-path",
      startFrame: 10,
      durationInFrames: 40,
      editable: true,
      motionPath: { path: "M0,20 C40,-30 160,130 200,80", autoRotate: false },
      bindings: {
        x: { kind: "keyframes", keys: [{ frame: 10, value: 0 }, { frame: 50, value: 200 }] },
        y: { kind: "keyframes", keys: [{ frame: 10, value: 20 }, { frame: 50, value: 80 }] },
      },
    });
  });

  it("replaces only a traced helper call when normalized traces are identical", () => {
    const source = `defineGsapTimeline(({ gsap, frames, unroll }) => {
      const timeline = gsap.timeline({ paused: true });
      unroll("cards", timeline, () => addCards(timeline, frames));
      return timeline;
    });`;
    expect(analyzeGsapUnrollGroups(source, { fps: 30 })[0]).toMatchObject({ id: "cards", timeline: "timeline", staticallySafe: true });
    const result = rewriteGsapUnrollSource(source, {
      fps: 30,
      groupId: "cards",
      operations: [
        { target: '[data-fd-id="a"]', kind: "fromTo", startFrame: 10, durationInFrames: 20, from: { x: -20, opacity: 0 }, to: { x: 0, opacity: 1 }, ease: "power2.out" },
        { target: '[data-fd-id="b"]', kind: "to", startFrame: 15, durationInFrames: 20, to: { y: 0 }, ease: "power2.out" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.traceVerified).toBe(true);
    expect(result.text).not.toContain("addCards(");
    expect(analyzeGsapSource(result.text, { fps: 30 }).operations.map((entry) => entry.id)).toEqual(["cards-1", "cards-2"]);
  });

  it("refuses nondeterministic unroll boundaries", () => {
    const source = `defineGsapTimeline(({ gsap, unroll }) => { const timeline = gsap.timeline(); unroll("bad", timeline, () => timeline.to(".x", { x: Math.random() })); return timeline; });`;
    expect(analyzeGsapUnrollGroups(source, { fps: 30 })[0]).toMatchObject({ staticallySafe: false, issues: [expect.stringContaining("Math.random")] });
  });

  it("refuses helper traces whose values depend on runtime DOM measurement", () => {
    const source = `defineGsapTimeline(({ gsap, unroll }) => {
      const timeline = gsap.timeline();
      const card = document.querySelector(".card");
      unroll("measured", timeline, () => timeline.to(card, { x: card.getBoundingClientRect().width + card.offsetWidth }));
      return timeline;
    });`;
    expect(analyzeGsapUnrollGroups(source, { fps: 30 })[0]).toMatchObject({
      staticallySafe: false,
      issues: [expect.stringContaining("getBoundingClientRect"), expect.stringContaining("offsetWidth")],
    });
  });
});
