import {
  combineCompositionSetups,
  createCharacterRiseSetup,
  createSplitScreenRevealSetup,
  createWipeRevealSetup,
  defineComposition,
  defineTimelineDocument,
  escapeHtml,
  spring,
  type CompRegistry,
  type CompositionSetup,
  type StudioComposition,
} from "framediff";
import { FPS, VIDEO_FRAMES } from "../data/constants";
import { heroGradeVideoSetup, preloadHeroLutsSetup } from "../effects/heroLooks";
import {
  heroClipMotionSetup,
  heroMotionRows,
  type HeroRawDocument,
} from "../effects/heroMotion";
import initialDocument from "./HeroRaw.comp.json";
import gridTimeline from "./HeroGridReveal.timeline.json";
import keynoteTimeline from "./HeroKeynoteStack.timeline.json";
import splitTimeline from "./HeroSplitScreen.timeline.json";
import textTimeline from "./HeroTextOverlays.timeline.json";

const DOCUMENT_FILE = "src/compositions/HeroRaw.comp.json";
const SCHEMA_FILE = "src/compositions/HeroRaw.schema.json";
const featureStyle = `
[data-fd-composition]{position:relative;overflow:hidden;background:transparent;color:#fff;font-family:"SF Pro Display",-apple-system,sans-serif}
[data-fd-clip],.motion,.fill{position:absolute;inset:0}.motion canvas,canvas{position:absolute;inset:0;width:100%;height:100%}.fill{background:#080a0c}
`;

const pane = (id: string, motionKey: string | null, dark = false, attributes = "") => {
  const motionAttribute = motionKey ? ` data-fd-motion-for="${motionKey}"` : "";
  return `<section data-fd-clip data-fd-id="${id}" ${attributes}><div class="motion${dark ? " fill" : ""}"${motionAttribute}>${dark || !motionKey ? "" : `<canvas data-fd-id="look-${motionKey}" data-fd-grade-video></canvas>`}</div></section>`;
};

function documentSetup(apply: (root: HTMLElement, value: HeroRawDocument) => void): CompositionSetup {
  return ({ root, document: initial, onDocument, onCleanup }) => {
    apply(root, initial as HeroRawDocument);
    const stop = onDocument((next) => apply(root, next as HeroRawDocument));
    onCleanup(stop);
  };
}

function setWipe(element: HTMLElement | null, settings: { wipe: string; wipeFrom: number; wipeTo: number }): void {
  if (!element) return;
  element.dataset.fdWipe = settings.wipe;
  element.dataset.fdWipeFrom = String(settings.wipeFrom);
  element.dataset.fdWipeTo = String(settings.wipeTo);
}

const gridDocumentSetup = documentSetup((root, value) => {
  setWipe(root.querySelector("[data-fd-id=grid-dark]"), value.features.grid.dark);
  setWipe(root.querySelector("[data-fd-id=grid-video]"), value.features.grid.video);
});

const gridSource = `<!doctype html><html><head><style>${featureStyle}</style></head><body>
<main data-fd-composition data-fd-id="HeroGridReveal" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="54" data-fd-kind="scene" data-fd-library="true" data-fd-alpha="true">
${pane("grid-dark", null, true)}
${pane("grid-video", "grid_1")}
</main></body></html>`;

export const heroGridRevealComp = defineComposition(gridSource, {
  document: initialDocument,
  timeline: defineTimelineDocument(gridTimeline),
  setup: combineCompositionSetups(
    preloadHeroLutsSetup,
    heroClipMotionSetup,
    gridDocumentSetup,
    createWipeRevealSetup(),
    heroGradeVideoSetup,
  ),
  meta: {
    file: "src/compositions/HeroRawFeatures.ts",
    sourceFormat: "generated",
    library: true,
    alpha: true,
    timelineFile: "src/compositions/HeroGridReveal.timeline.json",
    document: {
      file: DOCUMENT_FILE,
      schema: SCHEMA_FILE,
      bindings: {
        HeroGridReveal: "/features/grid",
        "grid-dark": "/features/grid/dark",
        "grid-video": "/motion/grid_1",
        "look-grid_1": "/looks/grid_1",
      },
      hotUpdate: "remount",
      inspector: { title: "GRID REVEAL" },
    },
  },
}) as StudioComposition;

const splitDocumentSetup = documentSetup((root, value) => {
  const pane = root.querySelector<HTMLElement>("[data-fd-id=split-right]");
  if (!pane) return;
  const mask = value.features.split.rightMask;
  pane.dataset.fdSplitFromPosition = String(mask.fromPosition);
  pane.dataset.fdSplitToPosition = String(mask.toPosition);
  pane.dataset.fdSplitFromEdge = String(mask.fromEdge);
  pane.dataset.fdSplitToEdge = String(mask.toEdge);
  pane.dataset.fdSplitCanvasWidth = String(mask.canvasWidth);
});

const splitSource = `<!doctype html><html><head><style>${featureStyle}</style></head><body>
<main data-fd-composition data-fd-id="HeroSplitScreen" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="43" data-fd-kind="scene" data-fd-library="true" data-fd-alpha="true">
${pane("split-left", "split_0")}
${pane("split-right", "split_1", false, 'data-fd-split-reveal="split_1"')}
</main></body></html>`;

export const heroSplitScreenComp = defineComposition(splitSource, {
  document: initialDocument,
  timeline: defineTimelineDocument(splitTimeline),
  setup: combineCompositionSetups(
    preloadHeroLutsSetup,
    heroClipMotionSetup,
    splitDocumentSetup,
    createSplitScreenRevealSetup({ motions: heroMotionRows }),
    heroGradeVideoSetup,
  ),
  meta: {
    file: "src/compositions/HeroRawFeatures.ts",
    sourceFormat: "generated",
    library: true,
    alpha: true,
    timelineFile: "src/compositions/HeroSplitScreen.timeline.json",
    document: {
      file: DOCUMENT_FILE,
      schema: SCHEMA_FILE,
      bindings: {
        HeroSplitScreen: "/features/split/rightMask",
        "split-left": "/motion/split_0",
        "split-right": "/motion/split_1",
        "look-split_0": "/looks/split_0",
        "look-split_1": "/looks/split_1",
      },
      hotUpdate: "remount",
      inspector: { title: "SPLIT SCREEN" },
    },
  },
}) as StudioComposition;

const keynoteDocumentSetup = documentSetup((root, value) => {
  setWipe(root.querySelector("[data-fd-id=keynote-dark]"), value.features.keynote.dark);
  setWipe(root.querySelector("[data-fd-id=keynote-middle]"), value.features.keynote.middle);
  setWipe(root.querySelector("[data-fd-id=keynote-close]"), value.features.keynote.close);
});

const keynoteSource = `<!doctype html><html><head><style>${featureStyle}</style></head><body>
<main data-fd-composition data-fd-id="HeroKeynoteStack" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="56" data-fd-kind="scene" data-fd-library="true" data-fd-alpha="true">
${pane("keynote-dark", null, true)}
${pane("keynote-middle", "keynote_1")}
${pane("keynote-close", "keynote_2")}
</main></body></html>`;

export const heroKeynoteStackComp = defineComposition(keynoteSource, {
  document: initialDocument,
  timeline: defineTimelineDocument(keynoteTimeline),
  setup: combineCompositionSetups(
    preloadHeroLutsSetup,
    heroClipMotionSetup,
    keynoteDocumentSetup,
    createWipeRevealSetup(),
    heroGradeVideoSetup,
  ),
  meta: {
    file: "src/compositions/HeroRawFeatures.ts",
    sourceFormat: "generated",
    library: true,
    alpha: true,
    timelineFile: "src/compositions/HeroKeynoteStack.timeline.json",
    document: {
      file: DOCUMENT_FILE,
      schema: SCHEMA_FILE,
      bindings: {
        HeroKeynoteStack: "/features/keynote",
        "keynote-dark": "/features/keynote/dark",
        "keynote-middle": "/motion/keynote_1",
        "keynote-close": "/motion/keynote_2",
        "look-keynote_1": "/looks/keynote_1",
        "look-keynote_2": "/looks/keynote_2",
      },
      hotUpdate: "remount",
      inspector: { title: "KEYNOTE STACK" },
    },
  },
}) as StudioComposition;

const overlayIds = [
  "caption-show",
  "caption-monday",
  "caption-bgremoval",
  "caption-dropin",
  "caption-switch",
  "card-allyou",
  "card-closing",
] as const;

const overlaySource = `<!doctype html><html><head><style>
[data-fd-composition]{position:relative;overflow:hidden;background:transparent;color:#fff;font-family:"SF Pro Display",-apple-system,sans-serif}
[data-fd-clip]{position:absolute;inset:0}.position{position:absolute;left:0;top:0}.rise{transform:translate(-50%,-76%);white-space:pre;letter-spacing:.5px;line-height:1.12;text-shadow:0 3px 24px rgba(0,0,0,.7)}.rise span{display:inline-block}
</style></head><body><main data-fd-composition data-fd-id="HeroTextOverlays" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="${VIDEO_FRAMES}" data-fd-kind="scene" data-fd-library="true" data-fd-alpha="true">
${overlayIds.map((id) => `<section data-fd-clip data-fd-id="${id}"><div class="position" data-fd-id="${id}-position"><div class="rise" data-fd-id="${id}-text" data-fd-rise-text></div></div></section>`).join("\n")}
</main></body></html>`;

const overlayDocumentSetup = documentSetup((root, value) => {
  for (const id of overlayIds) {
    const settings = value.overlays[id];
    const clip = root.querySelector<HTMLElement>(`[data-fd-id="${id}"]`);
    const text = root.querySelector<HTMLElement>(`[data-fd-id="${id}-text"]`);
    if (!clip || !text) continue;
    clip.style.background = settings.cardBackground;
    text.dataset.fdText = settings.text;
    text.dataset.fdAnimStart = String(settings.animStartFrame);
    text.dataset.fdAnimEnd = String(settings.animEndFrame);
    text.dataset.fdTextOpacity = String(settings.textOpacity);
    text.style.fontSize = `${settings.fontSize}px`;
    text.style.fontWeight = String(settings.fontWeight);
    text.style.color = settings.color;
  }
});

export const heroTextOverlaysComp = defineComposition(overlaySource, {
  document: initialDocument,
  timeline: defineTimelineDocument(textTimeline),
  setup: combineCompositionSetups(
    overlayDocumentSetup,
    createCharacterRiseSetup(),
  ),
  meta: {
    file: "src/compositions/HeroRawFeatures.ts",
    sourceFormat: "generated",
    library: true,
    alpha: true,
    timelineFile: "src/compositions/HeroTextOverlays.timeline.json",
    document: {
      file: DOCUMENT_FILE,
      schema: SCHEMA_FILE,
      bindings: {
        HeroTextOverlays: "/overlays",
        ...Object.fromEntries(overlayIds.flatMap((id) => [
          [id, `/overlays/${id}`],
          [`${id}-position`, `/overlays/${id}/position`],
          [`${id}-text`, `/overlays/${id}`],
        ])),
      },
      inspector: { title: "HERO TEXT OVERLAYS" },
    },
  },
}) as StudioComposition;

const bumperSource = `<!doctype html><html><head><style>
[data-fd-composition]{position:relative;overflow:hidden;background:radial-gradient(1200px 800px at 50.2% 50%,#0b244d 0%,#061b39 55%,#031122 100%);color:#fff;font-family:"SF Pro Display",-apple-system,sans-serif}
.wordmark{position:absolute;inset:0;display:grid;place-items:center;font-size:104px;font-weight:800;background-clip:text;color:transparent}.particles{position:absolute;inset:0}video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;mix-blend-mode:screen}
</style></head><body><main data-fd-composition data-fd-id="HeroLogoBumper" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="54" data-fd-kind="scene" data-fd-library="true">
<div class="particles" data-fd-id="bumper-particles"></div>
<div class="wordmark" data-fd-id="bumper-wordmark"></div>
<video data-fd-id="bumper-flare" data-fd-type="video" data-fd-src="${escapeHtml(initialDocument.bumper.flare.src)}" data-fd-muted="true" data-fd-fit="cover"></video>
</main></body></html>`;

const bumperSetup: CompositionSetup = ({ root, composition, document: initial, onFrame, onDocument, onCleanup }) => {
  let settings = (initial as HeroRawDocument).bumper;
  const apply = (next: HeroRawDocument) => {
    settings = next.bumper;
    const wordmark = root.querySelector<HTMLElement>("[data-fd-id=bumper-wordmark]");
    const particles = root.querySelector<HTMLElement>("[data-fd-id=bumper-particles]");
    if (wordmark) {
      wordmark.textContent = settings.text;
      wordmark.style.backgroundImage = settings.gradient;
    }
    if (particles && particles.childElementCount !== settings.particleCount) {
      particles.replaceChildren(...Array.from({ length: settings.particleCount }, () => {
        const particle = document.createElement("i");
        particle.className = "particle";
        return particle;
      }));
    }
  };
  apply(initial as HeroRawDocument);
  const stopDocument = onDocument((next) => apply(next as HeroRawDocument));
  const stopFrame = onFrame(({ frame }) => {
    const duration = composition.durationInFrames;
    const settle = spring({ frame, fps: FPS, config: { damping: settings.springDamping, mass: settings.springMass } });
    const exit = Math.pow(Math.max(0, Math.min(1, (frame - (duration - settings.exitDurationFrames)) / settings.exitDurationFrames)), 2);
    const wordmarkAmount = Math.max(0, Math.min(1, (frame - settings.introStartFrame) / settings.introDurationFrames));
    const particleAmount = 1 - Math.max(0, Math.min(1, (frame - 12) / 10));
    const wordmark = root.querySelector<HTMLElement>("[data-fd-id=bumper-wordmark]");
    if (wordmark) {
      wordmark.style.opacity = String((1 - exit) * wordmarkAmount);
      wordmark.style.filter = `blur(${(1 - wordmarkAmount) * 6}px) brightness(${1 + 0.15 * wordmarkAmount}) drop-shadow(0 10px 40px rgba(108,92,231,${0.4 * wordmarkAmount}))`;
    }
    root.querySelectorAll<HTMLElement>(".particle").forEach((particle, index) => {
      const hash = (index * 2654435761) % 997;
      const x = 260 + (hash % 1300) + (50 + hash % 90) * Math.min(1, frame / 20) * ((index % 2) * 2 - 1);
      const y = 360 + ((hash >> 3) % 360) - (50 + hash % 90) * 0.6 * Math.min(1, frame / 20);
      const size = 26 + hash % 46;
      const hue = 230 + hash % 65;
      particle.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:3px;background:hsl(${hue} 85% 66% / .85);opacity:${particleAmount * (0.5 + 0.5 * Math.abs(Math.sin(index * 2.1 + frame * 0.22)))};box-shadow:0 0 ${size * 1.8}px hsl(${hue} 90% 62% / .9)`;
    });
    const flare = root.querySelector<HTMLVideoElement>("[data-fd-id=bumper-flare]");
    if (flare) flare.style.opacity = String(settings.flare.opacity * settle * wordmarkAmount * (1 - exit));
  });
  onCleanup(stopDocument);
  onCleanup(stopFrame);
};

export const heroLogoBumperComp = defineComposition(bumperSource, {
  document: initialDocument,
  setup: bumperSetup,
  meta: {
    file: "src/compositions/HeroRawFeatures.ts",
    sourceFormat: "generated",
    library: true,
    document: {
      file: DOCUMENT_FILE,
      schema: SCHEMA_FILE,
      bindings: {
        HeroLogoBumper: "/bumper",
        "bumper-wordmark": "/bumper",
        "bumper-flare": "/bumper/flare",
      },
      inspector: { title: "LOGO BUMPER" },
    },
  },
}) as StudioComposition;

export const heroRawFeatureComps: CompRegistry = {
  "hero-grid-reveal": heroGridRevealComp,
  "hero-split-screen": heroSplitScreenComp,
  "hero-keynote-stack": heroKeynoteStackComp,
  "hero-text-overlays": heroTextOverlaysComp,
  "hero-logo-bumper": heroLogoBumperComp,
};
