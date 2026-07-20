import {
  combineCompositionSetups,
  defineComposition,
  escapeHtml,
  htmlAttributes,
  kebabCase,
  type StudioComposition,
} from "framediff";
import { FPS, VIDEO_FRAMES } from "../data/constants";
import {
  BUMPER,
  CARD_ALLYOU,
  CARD_CLOSING,
  HERO_AUDIO,
  HERO_CAPTIONS,
  HERO_GRID,
  HERO_KEYNOTE,
  HERO_SHOTS,
  HERO_SPLIT,
  HERO_UI_TEXT,
  type HeroPane,
} from "../data/heroEdl";
import { AE_BACKDROP } from "../data/heroAep.gen";
import { RAW_PROXY_ASSETS } from "../data/rawAssets";
import { heroGradeAttributes, heroGradeVideoSetup, setupHeroLookData } from "../effects/heroLooks";
import { heroMotionSetup } from "../effects/heroMotion";

const clipAttrs = (item: { name: string; from: number; durationInFrames: number }) =>
  htmlAttributes({
    "data-fd-clip": true,
    "data-fd-id": kebabCase(item.name),
    "data-fd-name": item.name,
    "data-fd-from": item.from,
    "data-fd-duration": item.durationInFrames,
  });

const gradedContent = (name: string, dark = false) => dark
  ? `<div class="motion fill" data-fd-motion-for="${escapeHtml(name)}"></div>`
  : `<div class="motion" data-fd-motion-for="${escapeHtml(name)}"><canvas data-fd-grade-video></canvas></div>`;

const shotHtml = HERO_SHOTS.map((shot) => shot.fx === "plane3d"
  ? `<section ${clipAttrs(shot)} data-fd-type="nested" data-fd-comp="HeroPlane3D.${escapeHtml(shot.name)}"></section>`
  : `<section ${clipAttrs(shot)} data-fd-src="${escapeHtml(shot.src)}" data-fd-trim-start="${shot.trimStart}" data-fd-playback-rate="${shot.playbackRate}" ${htmlAttributes(heroGradeAttributes(shot.name))}>${gradedContent(shot.name)}</section>`).join("\n");

const paneHtml = (pane: HeroPane, attributes = "") =>
  `<section ${clipAttrs(pane)} ${attributes} data-fd-src="${escapeHtml(pane.src)}" data-fd-trim-start="${pane.trimStart}" data-fd-playback-rate="${pane.playbackRate}" ${htmlAttributes(heroGradeAttributes(pane.name))}>${gradedContent(pane.name, pane.darkFill)}</section>`;

const gridHtml = HERO_GRID.map((pane, index) => paneHtml(pane, `data-fd-wipe="${index === 0 ? "fast" : "smooth"}" data-fd-wipe-from="0" data-fd-wipe-to="${index === 0 ? 8 : 17}"`)).join("\n");
const splitHtml = [paneHtml(HERO_SPLIT[0]), paneHtml(HERO_SPLIT[1], `data-fd-split-right="${escapeHtml(HERO_SPLIT[1].name)}"`)].join("\n");
const keynoteHtml = HERO_KEYNOTE.map((pane) => paneHtml(pane, `data-fd-wipe="fast" data-fd-wipe-from="${pane.darkFill ? -3 : -4}" data-fd-wipe-to="${pane.darkFill ? 3 : 8}"`)).join("\n");

const riseText = (item: { text: string; xPx: number; yPx: number; opacity: number; animStartFrame: number; animEndFrame: number }, options: { size: number; weight: number; color: string }) =>
  `<div class="rise" data-fd-rise-text data-fd-anim-start="${item.animStartFrame}" data-fd-anim-end="${item.animEndFrame}" data-fd-text-opacity="${item.opacity}" style="left:${item.xPx}px;top:${item.yPx}px;font-size:${options.size}px;font-weight:${options.weight};color:${options.color}">${[...item.text].map((character, index) => `<span data-fd-char="${index}">${escapeHtml(character)}</span>`).join("")}</div>`;

const cardHtml = (item: typeof CARD_ALLYOU | typeof CARD_CLOSING, size: number, weight: number) =>
  `<section ${clipAttrs(item)} data-fd-prop-text="${escapeHtml(item.text)}"><div class="card-bg"></div>${riseText(item, { size, weight, color: "#eef3fa" })}</section>`;

const captionsHtml = HERO_CAPTIONS.map((caption) =>
  `<section ${clipAttrs(caption)} data-fd-prop-text="${escapeHtml(caption.text)}">${riseText(caption, { size: 68, weight: 800, color: "#fff" })}</section>`).join("\n");

const bumperHtml = `<section data-fd-clip data-fd-id="bumper" data-fd-name="bumper" data-fd-from="${BUMPER.from}" data-fd-duration="${BUMPER.dur}" data-fd-bumper><div class="card-bg"></div><div class="particles">${Array.from({ length: 16 }, () => '<i class="particle"></i>').join("")}</div><div class="wordmark">${escapeHtml(HERO_UI_TEXT[0].text)}</div><video data-fd-src="${escapeHtml(RAW_PROXY_ASSETS.flare)}" data-fd-muted="true" data-fd-fit="cover"></video></section>`;

export const heroBackdrop = `radial-gradient(1200px 800px at ${(AE_BACKDROP.startPos[0] / 19.2).toFixed(1)}% ${(AE_BACKDROP.startPos[1] / 10.8).toFixed(1)}%, ${AE_BACKDROP.startColor}, ${AE_BACKDROP.endColor} 75%)`;
const heroRawSource = `<!doctype html><html><head><style>
[data-fd-composition]{position:relative;overflow:hidden;background:${heroBackdrop};color:#fff;font-family:"SF Pro Display",-apple-system,sans-serif}
[data-fd-clip],.motion,.card-bg{position:absolute;inset:0}.motion canvas,.motion .fill,canvas{position:absolute;inset:0;width:100%;height:100%}.fill{background:#080a0c}.card-bg{background:radial-gradient(1200px 800px at 50.2% 50%,#0b244d 0%,#061b39 55%,#031122 100%)}
.rise{position:absolute;transform:translate(-50%,-76%);white-space:pre;letter-spacing:.5px;line-height:1.12;text-shadow:0 3px 24px rgba(0,0,0,.7);pointer-events:none}.rise span{display:inline-block}
[data-fd-bumper]{overflow:hidden}.wordmark{position:absolute;inset:0;display:grid;place-items:center;font-size:104px;font-weight:800;background:linear-gradient(100deg,#b06bff,#8f6bff 22%,#6c5ce7 45%,#4d9fff 72%,#3fc9e3);background-clip:text;color:transparent}.particles{position:absolute;inset:0}[data-fd-bumper] video{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:screen}
</style></head><body><main data-fd-composition data-fd-id="HeroRaw" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="${VIDEO_FRAMES}" data-fd-kind="edit">
${shotHtml}${gridHtml}${splitHtml}${keynoteHtml}
${cardHtml(CARD_ALLYOU, 68, 500)}${bumperHtml}${cardHtml(CARD_CLOSING, 66, 500)}${captionsHtml}
<div data-fd-clip data-fd-id="finishing" data-fd-name="finishing" data-fd-from="0" data-fd-duration="${VIDEO_FRAMES}" data-fd-grade-layer data-fd-grade-exposure="0" data-fd-grade-contrast="0" data-fd-grade-saturation="1" data-fd-grade-temperature="0" data-fd-grade-vignette="0"></div>
<audio data-fd-type="audio" data-fd-src="${escapeHtml(HERO_AUDIO.bed)}" data-fd-volume="1" data-fd-audio-bed></audio>
<section data-fd-clip data-fd-id="shine" data-fd-name="shine" data-fd-from="${HERO_AUDIO.shineFrom}" data-fd-duration="120"><audio data-fd-type="audio" data-fd-src="${escapeHtml(HERO_AUDIO.shine)}" data-fd-volume="1"></audio></section>
<section data-fd-clip data-fd-id="logo-reveal" data-fd-name="logo reveal" data-fd-from="${HERO_AUDIO.logoRevealFrom}" data-fd-duration="${VIDEO_FRAMES - HERO_AUDIO.logoRevealFrom}"><audio data-fd-type="audio" data-fd-src="${escapeHtml(HERO_AUDIO.logoReveal)}" data-fd-volume="1"></audio></section>
</main></body></html>`;

const heroEditableData = [
  { type: "object-array" as const, file: "src/data/heroAep.gen.ts", exportName: "AE_EDL", title: "SHOT DATA (AEP-exact)", fields: [{ key: "from", label: "from frame" }, { key: "durationInFrames", label: "duration frames" }, { key: "srcIn", label: "AE source in seconds" }, { key: "rate", label: "playback rate" }] },
  ...["AE_GRID", "AE_SPLIT", "AE_KEYNOTE"].map((exportName) => ({
    type: "object-array" as const,
    file: "src/data/heroAep.gen.ts",
    exportName,
    title: `${exportName.slice(3)} PANE DATA`,
    fields: [
      { key: "from", label: "AE layer start" },
      { key: "durationInFrames", label: "AE layer duration" },
      { key: "srcIn", label: "source in seconds" },
      { key: "rate", label: "playback rate" },
      { key: "xPx", label: "x" },
      { key: "yPx", label: "y" },
    ],
  })),
  { type: "object-array" as const, file: "src/data/heroAep.gen.ts", exportName: "AE_TEXTS", title: "TEXT LAYERS (AEP-exact)", fields: [{ key: "text", label: "text", type: "text" as const }, "from", "durationInFrames", "xPx", "yPx", "opacity", "animStartFrame", "animEndFrame"] },
  { type: "object-array" as const, file: "src/data/heroEdl.ts", exportName: "HERO_UI_TEXT", title: "AUTHORED COPY", fields: [{ key: "text", label: "wordmark", type: "text" as const }] },
];

export const heroRawComp = defineComposition(heroRawSource, {
  setup: combineCompositionSetups(setupHeroLookData, heroMotionSetup, heroGradeVideoSetup),
  meta: {
    kind: "edit",
    file: "src/compositions/HeroRaw.ts",
    sourceFormat: "generated",
    deps: ["src/data/heroAep.gen.ts", "src/data/heroEdl.ts", "src/effects/heroGrade.ts", "src/data/rawAssets.ts", "src/effects/luts.ts", "src/data/constants.ts"],
  },
}) as StudioComposition;
heroRawComp.meta = { ...heroRawComp.meta, editableData: heroEditableData };
