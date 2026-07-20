// Derive src/data/heroAep.gen.ts from ae/aep-dump.json — the AEP ground truth, distilled into
// plain-literal tables the example (and the Studio's literal rewrites) can consume.
//
//   node scripts/derive-from-aep.ts        (Node 24+, runs erasable TS directly)
//
// Everything here is measured from the dumped After Effects project. The reference render is
// never read. Where the Desktop raw files differ from the AEP's sources (the re-rendered
// latest2* clips), heroEdl.ts overlays empirically fitted trims on top of these rows.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aeCameraShot,
  aeFindComp,
  aeProp,
  aeSourceTime,
  aeValue,
  aeVisibleWindows,
  type AeComp,
  type AeDump,
  type AeLayer,
} from "../../../packages/framediff/src/ae/aeImport.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dump = JSON.parse(readFileSync(join(here, "../ae/aep-dump.json"), "utf8")) as AeDump;
const comp = aeFindComp(dump, "LightTwist");
if (!comp) throw new Error("LightTwist comp not found in dump");
const FPS = comp.frameRate;
// Cut times land on the nearest frame: grid-aligned in-points (in·fps within 1e-3 of an
// integer) round to it, and the off-grid ones (blazer 743.19, bumper 842.08, tripod_a 763.2…)
// were verified against the reference to cut at round(), not ceil() — the full-video compare
// showed 1-frame outliers at exactly the ceil-shifted cuts.
const toFrame = (sec: number) => Math.round(sec * FPS);

const layerByIndex = new Map(comp.layers.map((l) => [l.index, l]));
const L = (index: number): AeLayer => {
  const l = layerByIndex.get(index);
  if (!l) throw new Error(`layer ${index} missing`);
  return l;
};

// ---- names for the single-layer EDL rows (AE layer index → shot name) ----
const SHOT_NAMES: Record<number, string> = {
  46: "open",
  47: "phone",
  38: "news_a",
  37: "news_b",
  36: "news_c",
  35: "uizoom",
  33: "june3d",
  29: "cam4",
  20: "hf_talk",
  19: "magnific",
  18: "cam6",
  16: "greenwide",
  15: "greentrack",
  14: "desk",
  13: "smartest",
  12: "blazer",
  11: "tripod_a",
  10: "tripod_b",
  9: "keynote_b",
};
// layered moments rendered as composites, not single visible-window rows
const GRID = [43, 42];
const SPLIT = [31, 30];
const KEYNOTE = [25, 24, 23];
const BUMPER_LAYER = 8;

// footage/precomp video layers that occupy the frame (excludes text/adjustment/camera/audio/bg)
const VIDEO_LAYERS = new Set([...Object.keys(SHOT_NAMES).map(Number), ...GRID, ...SPLIT, ...KEYNOTE, BUMPER_LAYER]);

const num = (v: unknown, fb: number) => (typeof v === "number" ? v : fb);
const v2 = (v: unknown, fb: [number, number]): [number, number] =>
  Array.isArray(v) ? [v[0] ?? fb[0], v[1] ??fb[1]] : fb;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

// source pixel dimensions by item name (first match wins; identical duplicates exist)
const sourceSizes = new Map<string, [number, number]>();
for (const it of dump.items) {
  const item = it as { name?: string; width?: number; height?: number };
  if (item.name && item.width && item.height && !sourceSizes.has(item.name)) {
    sourceSizes.set(item.name, [item.width, item.height]);
  }
}
const sizeOf = (l: AeLayer): [number, number] => sourceSizes.get(l.sourceName ?? l.name) ?? [comp.width, comp.height];

// ---- 2D transform sampling: anchor + LINEAR pos/scale keys (or statics) per layer ----
interface Motion {
  anchor: [number, number];
  srcW: number;
  srcH: number;
  f0: number;
  f1: number;
  pos0: [number, number];
  pos1: [number, number];
  scale0: number;
  scale1: number;
  /** interpolation between the keys, from the dump's key types (6612 linear, else AE bezier) */
  ease: "linear" | "smooth";
}
function motionOf(l: AeLayer, windowStart: number): Motion {
  const [srcW, srcH] = sizeOf(l);
  const anchorProp = aeProp(l, "Transform", "Anchor Point");
  const posProp = aeProp(l, "Transform", "Position");
  const sclProp = aeProp(l, "Transform", "Scale");
  const anchor = v2(anchorProp ? aeValue(anchorProp, windowStart) : null, [srcW / 2, srcH / 2]);
  const allKeys = [...(posProp?.keys ?? []), ...(sclProp?.keys ?? [])];
  const ease: Motion["ease"] = allKeys.some(
    (k) => k.inInterpolation !== "6612" || k.outInterpolation !== "6612",
  )
    ? "smooth"
    : "linear";
  const keyTimes = [
    ...(posProp?.keys?.map((k) => k.time) ?? []),
    ...(sclProp?.keys?.map((k) => k.time) ?? []),
  ].sort((a, b) => a - b);
  const t0 = keyTimes[0] ?? windowStart;
  const t1 = keyTimes[keyTimes.length - 1] ?? windowStart;
  const posAt = (t: number) => v2(posProp ? aeValue(posProp, t) : null, [comp.width / 2, comp.height / 2]);
  const sclAt = (t: number) => v2(sclProp ? aeValue(sclProp, t) : null, [100, 100])[0];
  return {
    anchor: [r3(anchor[0]), r3(anchor[1])],
    srcW,
    srcH,
    f0: r3((t0 - windowStart) * FPS),
    f1: r3((t1 - windowStart) * FPS),
    pos0: [r3(posAt(t0)[0]), r3(posAt(t0)[1])],
    pos1: [r3(posAt(t1)[0]), r3(posAt(t1)[1])],
    scale0: r3(sclAt(t0)),
    scale1: r3(sclAt(t1)),
    ease,
  };
}

// ---- the single-layer EDL: visible windows of video layers, top-most wins ----
const windows = aeVisibleWindows(comp, (l) => VIDEO_LAYERS.has(l.index));
interface EdlRow extends Motion {
  name: string;
  layerIndex: number;
  sourceName: string;
  from: number;
  durationInFrames: number;
  srcIn: number;
  rate: number;
}
const edl: EdlRow[] = [];
for (const w of windows) {
  const name = SHOT_NAMES[w.layer.index];
  if (!name) continue; // layered moments handled below
  const from = toFrame(w.from);
  const durationInFrames = toFrame(w.to) - from;
  if (durationInFrames <= 0) continue;
  edl.push({
    name,
    layerIndex: w.layer.index,
    sourceName: w.layer.sourceName ?? w.layer.name,
    from,
    durationInFrames,
    srcIn: r4(aeSourceTime(w.layer, from / FPS)),
    rate: r4(100 / (w.layer.stretch || 100)),
    ...motionOf(w.layer, from / FPS),
  });
}
edl.sort((a, b) => a.from - b.from);

// ---- layered moments: every participating layer with its own window/срcIn/motion ----
interface PaneRow extends Motion {
  name: string;
  layerIndex: number;
  sourceName: string;
  from: number;
  durationInFrames: number;
  srcIn: number;
  rate: number;
  darkFill: boolean;
}
function paneRows(groupName: string, indices: number[]): PaneRow[] {
  return indices.map((idx, i) => {
    const l = L(idx);
    const from = toFrame(Math.max(0, l.inPoint));
    const durationInFrames = toFrame(l.outPoint) - from;
    const fill = aeProp(l, "Effects", "Fill");
    return {
      name: `${groupName}_${i}`,
      layerIndex: idx,
      sourceName: l.sourceName ?? l.name,
      from,
      durationInFrames,
      srcIn: r4(aeSourceTime(l, from / FPS)),
      rate: r4(100 / (l.stretch || 100)),
      darkFill: !!fill,
      ...motionOf(l, from / FPS),
    };
  });
}
const grid = paneRows("grid", GRID);
const split = paneRows("split", SPLIT);
const keynote = paneRows("keynote", KEYNOTE);

// ---- the four 3D-camera shots, converted to plane-relative world units ----
const CAMERA_SHOTS: Array<{ name: string; cameraIndex: number; planeIndex: number }> = [
  { name: "uizoom", cameraIndex: 34, planeIndex: 35 },
  { name: "june3d", cameraIndex: 32, planeIndex: 33 },
  { name: "cam4", cameraIndex: 28, planeIndex: 29 },
  { name: "cam6", cameraIndex: 17, planeIndex: 18 },
];
const cameraMoves = CAMERA_SHOTS.map(({ name, cameraIndex, planeIndex }) => {
  const plane = L(planeIndex);
  const row = edl.find((r) => r.layerIndex === planeIndex);
  if (!row) throw new Error(`no EDL window for camera shot ${name}`);
  // screen-space DoF: aperture converts exactly (A·blur%·zoom/compHeight → CoC in px)
  const shot = aeCameraShot({
    cameraLayer: L(cameraIndex),
    planeLayer: plane,
    planeSourceSize: sizeOf(plane),
    comp,
    shotStart: row.from / FPS,
  });
  const ks = shot.cameraKeyframes;
  const first = ks[0];
  const last = ks[ks.length - 1];
  const axisFocus = (k: (typeof ks)[number]): [number, number, number] => {
    const eye = k.pose.cameraPosition ?? [0, 0, 2];
    const tgt = k.pose.cameraTarget ?? [0, 0, 0];
    const d = k.pose.focusDistance ?? Math.hypot(tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]);
    const len = Math.hypot(tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]) || 1;
    return [
      eye[0] + ((tgt[0] - eye[0]) / len) * d,
      eye[1] + ((tgt[1] - eye[1]) / len) * d,
      eye[2] + ((tgt[2] - eye[2]) / len) * d,
    ];
  };
  const f0 = axisFocus(first);
  const f1 = axisFocus(last);
  return {
    name,
    startFrame: r3(first.frame),
    endFrame: r3(last.frame),
    startCameraX: r4(first.pose.cameraPosition![0]),
    startCameraY: r4(first.pose.cameraPosition![1]),
    startCameraZ: r4(first.pose.cameraPosition![2]),
    endCameraX: r4(last.pose.cameraPosition![0]),
    endCameraY: r4(last.pose.cameraPosition![1]),
    endCameraZ: r4(last.pose.cameraPosition![2]),
    startTargetX: r4(first.pose.cameraTarget![0]),
    startTargetY: r4(first.pose.cameraTarget![1]),
    startTargetZ: r4(first.pose.cameraTarget![2]),
    endTargetX: r4(last.pose.cameraTarget![0]),
    endTargetY: r4(last.pose.cameraTarget![1]),
    endTargetZ: r4(last.pose.cameraTarget![2]),
    startFocalLength: r4(first.pose.focalLength!),
    endFocalLength: r4(last.pose.focalLength!),
    startFocusX: r4(f0[0]),
    startFocusY: r4(f0[1]),
    startFocusZ: r4(f0[2]),
    endFocusX: r4(f1[0]),
    endFocusY: r4(f1[1]),
    endFocusZ: r4(f1[2]),
    // AE keys Focus Distance as a SCALAR (axial px) — interpolating it as a distance is what
    // AE renders. The focus point above is derived (camera-axis × distance) and only correct
    // AT the keys; mid-move, point-lerp + dist() drifts off AE's focal plane (uizoom: ~110px
    // at the whip's midpoint — enough to melt the sidebar AE keeps sharp). Prefer these.
    startFocusDistance: r4(first.pose.focusDistance ?? 0),
    endFocusDistance: r4(last.pose.focusDistance ?? 0),
    startDepthOfField: r4(first.pose.depthOfField ?? 0),
    endDepthOfField: r4(last.pose.depthOfField ?? 0),
    planeW: r4(shot.planeSize[0]),
    planeH: r4(shot.planeSize[1]),
    planeX: 0,
    planeY: 0,
    planeZ: 0,
    planeScale: 1,
    planeRotXDeg: 0,
    planeRotYDeg: 0,
    planeRotZDeg: 0,
    // FrameDiff finishing controls live beside the imported camera so Studio can tune the
    // complete 3D shot without hiding an override in the composition setup. uizoom's 0.05
    // value preserves the fitted result that previously lived in FIT_DOF.
    maxBlur: name === "uizoom" ? 0.05 : 0.035,
    shutterAngle: 90,
    motionBlurSamples: 9,
  };
});

// ---- text layers: captions + the two cards, with the animator's reveal window ----
const TEXT_LAYERS: Array<{ name: string; index: number }> = [
  { name: "caption_show", index: 41 },
  { name: "caption_monday", index: 40 },
  { name: "caption_bgremoval", index: 27 },
  { name: "caption_dropin", index: 26 },
  { name: "caption_switch", index: 22 },
  { name: "card_allyou", index: 21 },
  { name: "card_closing", index: 7 },
];
const texts = TEXT_LAYERS.map(({ name, index }) => {
  const l = L(index);
  const from = toFrame(Math.max(0, l.inPoint));
  const srcText = aeProp(l, "Text", "Source Text");
  const posProp = aeProp(l, "Transform", "Position");
  const opProp = aeProp(l, "Transform", "Opacity");
  const offset = aeProp(l, "Text", "Animators", "Animator 1", "Selectors", "Range Selector 1", "Offset");
  const keys = offset?.keys ?? [];
  const pos = v2(posProp ? aeValue(posProp, l.inPoint) : null, [comp.width / 2, comp.height / 2]);
  return {
    name,
    text: String(srcText?.value ?? l.name),
    from,
    durationInFrames: toFrame(l.outPoint) - from,
    xPx: r3(pos[0]),
    yPx: r3(pos[1]),
    opacity: num(opProp ? aeValue(opProp, l.inPoint) : null, 100) / 100,
    // per-character rise: Range Selector Offset −89 → 100 across this window (frames rel. layer in)
    animStartFrame: keys.length ? r3((keys[0].time - l.inPoint) * FPS) : 0,
    animEndFrame: keys.length ? r3((keys[keys.length - 1].time - l.inPoint) * FPS) : 0,
  };
});

// ---- audio cue times + background gradient + bumper window ----
const audio = {
  shineFrom: toFrame(L(39).inPoint),
  logoRevealFrom: toFrame(L(6).inPoint),
};
const bumperLayer = L(BUMPER_LAYER);
const bumper = { from: toFrame(bumperLayer.inPoint), durationInFrames: toFrame(bumperLayer.outPoint) - toFrame(bumperLayer.inPoint) };
const bgLayer = L(48);
const ramp = {
  start: aeValue(aeProp(bgLayer, "Effects", "Gradient Ramp", "Start Color")!, 0) as number[],
  end: aeValue(aeProp(bgLayer, "Effects", "Gradient Ramp", "End Color")!, 0) as number[],
  startPos: v2(aeValue(aeProp(bgLayer, "Effects", "Gradient Ramp", "Start of Ramp")!, 0), [960, 540]),
  endPos: v2(aeValue(aeProp(bgLayer, "Effects", "Gradient Ramp", "End of Ramp")!, 0), [1422, 1089]),
};
const hex = (c: number[]) =>
  "#" + c.slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");

// ---- emit ----
const lit = (v: unknown): string => JSON.stringify(v).replace(/"([A-Za-z_$][A-Za-z0-9_$]*)":/g, "$1: ").replace(/,/g, ", ");
const rows = (arr: unknown[]) => arr.map((r) => `  ${lit(r)},`).join("\n");

const out = `// GENERATED from ae/aep-dump.json by scripts/derive-from-aep.ts — regenerate with:
//   node scripts/derive-from-aep.ts
// Studio gestures may rewrite these literals; regenerating restores the AEP-exact values.
// Times are LightTwist comp frames @ ${FPS} fps; world units: 1 = comp height (1080 px).

export interface AeEdlRow {
  name: string;
  layerIndex: number;
  sourceName: string;
  /** placement in the comp, frames */
  from: number;
  durationInFrames: number;
  /** exact source seconds at the window start (startTime + stretch applied) */
  srcIn: number;
  /** source seconds per comp second (100/stretch) */
  rate: number;
  /** 2D transform: anchor px in source, LINEAR pos/scale keys at f0→f1 (frames rel. window) */
  anchor: [number, number];
  srcW: number;
  srcH: number;
  f0: number;
  f1: number;
  pos0: [number, number];
  pos1: [number, number];
  scale0: number;
  scale1: number;
  /** interpolation between the keys, from the AE key types (6612 linear, else AE bezier) */
  ease: "linear" | "smooth";
}

export interface AePaneRow extends AeEdlRow {
  /** the AE layer carries a Fill effect — it renders as a dark silhouette backdrop */
  darkFill: boolean;
}

export const AE_META = { fps: ${FPS}, width: ${comp.width}, height: ${comp.height}, durationInFrames: ${toFrame(comp.duration)} } as const;

/** Single-layer shots: the recovered cut list (visibility-resolved, top-most layer wins). */
export const AE_EDL: AeEdlRow[] = [
${rows(edl)}
];

/** The grid moment (stream feio precomp ×2): bottom pane first; darkFill = silhouette copy. */
export const AE_GRID: AePaneRow[] = [
${rows(grid)}
];

/** The split moment (hf left + 13-35-32 right), masks slide with the position keys. */
export const AE_SPLIT: AePaneRow[] = [
${rows(split)}
];

/** The keynote moment: three stacked panes of the same source at different src-ins. */
export const AE_KEYNOTE: AePaneRow[] = [
${rows(keynote)}
];

/** The four AE 3D-camera shots in the camera3d rig convention (plane-relative world units).
 *  start/endFrame are fractional frames relative to each shot's window — they may lie outside
 *  it: the visible move is a mid-motion slice of the smoothstep-eased curve, exactly like AE. */
export const AE_PLANE_CAMERA_MOVES = [
${rows(cameraMoves)}
];

/** Text layers: in-scene captions and the two full-frame cards.
 *  Reveal: per-character rise, Range Selector Offset −89→100 over anim window (frames rel. from). */
export const AE_TEXTS = [
${rows(texts)}
];

export const AE_AUDIO = ${lit(audio)} as const;

/** Render Comp (logo bumper) window; content stays code-built. */
export const AE_BUMPER = ${lit(bumper)} as const;

/** The always-on backdrop: AE Gradient Ramp (radial) on the bottom solid. */
export const AE_BACKDROP = {
  startColor: "${hex(ramp.start)}",
  endColor: "${hex(ramp.end)}",
  startPos: ${lit(ramp.startPos)},
  endPos: ${lit(ramp.endPos)},
} as const;
`;

const outPath = join(here, "../src/data/heroAep.gen.ts");
writeFileSync(outPath, out);
console.log(`wrote ${outPath}`);
console.log(`EDL rows: ${edl.length}, grid: ${grid.length}, split: ${split.length}, keynote: ${keynote.length}, cameras: ${cameraMoves.length}, texts: ${texts.length}`);
for (const r of edl) {
  console.log(
    `  ${String(r.from).padStart(3)}f +${String(r.durationInFrames).padStart(3)}f  ${r.name.padEnd(10)} src-in ${String(r.srcIn).padStart(8)}s ×${r.rate}  (L${r.layerIndex} ${r.sourceName})`,
  );
}
