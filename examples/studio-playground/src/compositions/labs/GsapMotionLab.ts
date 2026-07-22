import { defineComposition } from "framediff";
import { defineGsapTimeline } from "framediff/gsap";
import source from "./GsapMotionLab.html?raw";
import document from "./GsapMotionLab.comp.json";

export const gsapMotionSetup = defineGsapTimeline(({ gsap, frames, unroll }) => {
  const timeline = gsap.timeline({ paused: true });
  timeline.fromTo(
    "[data-fd-id=\"motion-title\"]",
    { x: 103.225, y: 664.569 },
    { id: "title-enter", keyframes: [
      { x: 1014.548, y: 426.735, duration: frames(135), ease: "none" },
    ] },
    frames(8),
  );
  timeline.fromTo(
    '[data-fd-id="motion-copy"]',
    { y: 40, opacity: 0 },
    { id: "copy-rise", y: 0, opacity: 1, duration: frames(24), ease: "power2.out" },
    frames(25),
  );
  timeline.fromTo(
    '[data-fd-id="motion-orb"]',
    { scale: 0.72, rotation: -70, opacity: 0 },
    { id: "orb-arrive", scale: 1, rotation: 0, opacity: 1, duration: frames(48), ease: "back.out(1.35)" },
    frames(4),
  );
  timeline.fromTo(
    '[data-fd-id="card-preview"]',
    { y: 70, opacity: 0 },
    { id: "preview-card-rise", y: 0, opacity: 1, duration: frames(30), ease: "power3.out" },
    frames(42),
  );
  timeline.fromTo(
    '[data-fd-id="card-export"]',
    { y: 70, opacity: 0 },
    { id: "export-card-rise", y: 0, opacity: 1, duration: frames(30), ease: "power3.out" },
    frames(47),
  );
  timeline.fromTo(
    '[data-fd-id="card-source"]',
    { y: 70, opacity: 0 },
    { id: "source-card-rise", y: 0, opacity: 1, duration: frames(30), ease: "power3.out" },
    frames(52),
  );
  timeline.set(
    '[data-fd-id="motion-badge"]',
    { id: "badge-reveal", opacity: 1 },
    frames(78),
  );
  timeline.fromTo(
    "[data-fd-id=\"orb-core\"]",
    { rotation: 0 },
    { id: "orb-core-rotation", rotation: 45, duration: frames(30), ease: "power2.out" },
    frames(20),
  );
  timeline.to(
    "[data-fd-id=\"path-product\"]",
    { id: "product-flight", duration: frames(54), ease: "none", motionPath: { path: "M1030,620 C1130.8,784.267 1270.8,830.933 1450,760", autoRotate: false } },
    frames(82),
  );
  unroll("helper-dots", timeline, () => {
    ["trace-a", "trace-b", "trace-c"].forEach((id, index) => {
      timeline.fromTo(
        `[data-fd-id="${id}"]`,
        { y: -18, opacity: 0 },
        { y: 0, opacity: 1, duration: frames(18), ease: "power1.out" },
        frames(12 + index * 5),
      );
    });
  });
  return timeline;
});

export const gsapMotionLabComp = defineComposition(source, {
  document,
  setup: gsapMotionSetup,
  meta: {
    document: {
      file: "src/compositions/labs/GsapMotionLab.comp.json",
      schema: "src/compositions/labs/GsapMotionLab.schema.json",
      bindings: {
        eyebrow: "/eyebrow", "motion-title-lead": "/titleLead", "motion-title-accent": "/titleAccent", "motion-copy": "/copy",
        "card-preview-label": "/previewLabel", "card-preview-copy": "/previewCopy", "card-export-label": "/exportLabel", "card-export-copy": "/exportCopy",
        "card-source-label": "/sourceLabel", "card-source-copy": "/sourceCopy", "motion-badge": "/badge", "path-product": "/product",
      },
    },
  },
});
