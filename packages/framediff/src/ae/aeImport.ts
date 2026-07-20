// Import After Effects project data — dumped to JSON by an ExtendScript like
// examples/hero-lower-third/scripts/ae-dump-project.jsx — into FrameDiff terms.
//
// What this module knows how to do:
//   · evaluate dumped keyframed properties over time with AE's interpolation semantics
//     (LINEAR, HOLD, and default BEZIER — which, at 33% influence / speed 0, is exactly
//     smoothstep in value-vs-time)
//   · map a layer's comp time to source time through startTime + stretch
//   · compute which video layer is visible when (top-most wins), i.e. recover the EDL
//   · convert an AE 3D camera + a flat 3D plane layer into VideoPlane3D terms:
//     plane-relative world units (1 unit = comp height), y up, camera on +z
//
// AE coordinate conventions: x right, y DOWN, z INTO the screen; a camera sits at negative z
// and its Zoom (px) is the distance at which a layer renders 1:1 — so vertical FOV is
// 2·atan(compHeight / 2·zoom), which maps to focalLength = sensorHeight·zoom / compHeight.

import type { V3 } from "../effects/mat4";
import type { VirtualCameraPose } from "../effects/camera";

/** One keyframe as dumped: interpolation ids are AE's KeyframeInterpolationType enum values. */
export interface AeKey {
  time: number;
  value: number | number[] | string | null;
  inInterpolation?: string | null;
  outInterpolation?: string | null;
}

export interface AeProperty {
  name: string;
  matchName?: string;
  value?: number | number[] | string | null;
  keys?: AeKey[];
  expression?: string;
  expressionEnabled?: boolean;
  properties?: AeProperty[];
}

export interface AeLayer {
  index: number;
  name: string;
  enabled?: boolean | null;
  hasVideo?: boolean | null;
  hasAudio?: boolean | null;
  threeDLayer?: boolean | null;
  adjustmentLayer?: boolean | null;
  nullLayer?: boolean | null;
  guideLayer?: boolean | null;
  startTime: number;
  inPoint: number;
  outPoint: number;
  /** percent; 100 = realtime, 111.11 ≈ 0.9× speed, 81 ≈ 1.235× speed */
  stretch: number;
  sourceName?: string | null;
  sourceFile?: string | null;
  properties?: AeProperty[];
}

export interface AeComp {
  name: string;
  typeName?: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  layers: AeLayer[];
}

export interface AeDump {
  projectFile?: string | null;
  items: Array<AeComp | Record<string, unknown>>;
}

const AE_LINEAR = "6612";
const AE_HOLD = "6614";

/** AE's default bezier temporal ease (33.3% influence, speed 0) is exactly smoothstep. */
export const aeEase = (u: number) => {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
};

const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVal = (a: number | number[], b: number | number[], t: number): number | number[] => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => lerpNum(x, b[i] ?? x, t));
  if (typeof a === "number" && typeof b === "number") return lerpNum(a, b, t);
  return a;
};

/** Find a composition item by name in the dump. */
export function aeFindComp(dump: AeDump, name: string): AeComp | undefined {
  return dump.items.find(
    (it): it is AeComp => (it as AeComp).typeName === "Composition" && (it as AeComp).name === name,
  );
}

/** Walk a property path by display names, e.g. aeProp(layer, "Transform", "Position"). */
export function aeProp(owner: { properties?: AeProperty[] }, ...path: string[]): AeProperty | undefined {
  let props = owner.properties;
  let found: AeProperty | undefined;
  for (const name of path) {
    found = props?.find((p) => p.name === name);
    if (!found) return undefined;
    props = found.properties;
  }
  return found;
}

/**
 * Evaluate a dumped property at a comp time. Static values pass through; keyframed values
 * interpolate per-segment: HOLD holds, LINEAR lerps, BEZIER (dump carries no ease data)
 * assumes AE's default ease = smoothstep. Clamped outside the key range.
 */
export function aeValue(prop: AeProperty, time: number): number | number[] | string | null {
  const keys = prop.keys;
  if (!keys?.length) return prop.value ?? null;
  if (time <= keys[0].time) return keys[0].value as number | number[];
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value as number | number[];
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i];
    const k1 = keys[i + 1];
    if (time > k1.time) continue;
    if (k0.outInterpolation === AE_HOLD) return k0.value as number | number[];
    const u = (time - k0.time) / (k1.time - k0.time);
    const linear = k0.outInterpolation === AE_LINEAR && k1.inInterpolation === AE_LINEAR;
    const t = linear ? u : aeEase(u);
    return lerpVal(k0.value as number | number[], k1.value as number | number[], t);
  }
  return last.value as number | number[];
}

const asV3 = (v: number | number[] | string | null, fallback: V3 = [0, 0, 0]): V3 =>
  Array.isArray(v) ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : fallback;
const asNum = (v: number | number[] | string | null, fallback: number): number =>
  typeof v === "number" ? v : fallback;

/** Map a layer's comp time to source-media time through startTime and stretch. */
export function aeSourceTime(layer: AeLayer, compTime: number): number {
  const stretch = layer.stretch || 100;
  return (compTime - layer.startTime) * (100 / stretch);
}

export interface AeVisibleWindow {
  /** the AE layer that is on top during this window */
  layer: AeLayer;
  /** comp seconds */
  from: number;
  to: number;
}

/**
 * Recover the cut list: for the layers accepted by `include`, compute which one is visible
 * when — AE stacking order, lower index on top. Returns windows sorted by time; gaps (nothing
 * visible) are simply absent.
 */
export function aeVisibleWindows(comp: AeComp, include: (layer: AeLayer) => boolean): AeVisibleWindow[] {
  const layers = comp.layers.filter((l) => l.enabled !== false && include(l));
  const cuts = new Set<number>();
  for (const l of layers) {
    cuts.add(Math.max(0, l.inPoint));
    cuts.add(Math.min(comp.duration, l.outPoint));
  }
  const times = [...cuts].sort((a, b) => a - b);
  const windows: AeVisibleWindow[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i];
    const t1 = times[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const mid = (t0 + t1) / 2;
    const top = layers
      .filter((l) => l.inPoint <= mid && mid < l.outPoint)
      .sort((a, b) => a.index - b.index)[0];
    if (!top) continue;
    const prev = windows[windows.length - 1];
    if (prev && prev.layer === top && Math.abs(prev.to - t0) < 1e-9) prev.to = t1;
    else windows.push({ layer: top, from: t0, to: t1 });
  }
  return windows;
}

export interface AeCameraShotInput {
  /** the AE camera layer (Transform/Position + Point of Interest + Camera Options) */
  cameraLayer: AeLayer;
  /** the flat 3D layer the camera photographs; must have static transform, no rotation */
  planeLayer: AeLayer;
  /** the plane layer's source dimensions in px (footage or precomp) */
  planeSourceSize: [number, number];
  comp: Pick<AeComp, "width" | "height" | "frameRate">;
  /** comp seconds where the FrameDiff <Sequence> window for this shot starts */
  shotStart: number;
  /** sensor height for focalLength conversion; VideoPlane3D's default is 24mm */
  sensorHeight?: number;
  /** calibration for AE aperture·blurLevel → renderer depthOfField (approximate model) */
  dofScale?: number;
}

export interface AeCameraShot {
  /** plane width/height in world units (1 unit = comp height) */
  planeSize: [number, number];
  /** poses at the camera's own key times, frames relative to shotStart (may lie outside the clip) */
  cameraKeyframes: Array<{ frame: number; pose: VirtualCameraPose }>;
}

/**
 * Convert an AE 3D-camera shot into VideoPlane3D terms. Everything is expressed relative to the
 * plane's center: AE (x right, y down, z in) → renderer (x right, y up, camera toward +z), with
 * 1 world unit = comp height in px. The camera's key times become fractional frame offsets from
 * `shotStart`, so a move that eases across a wider span than the cut plays back as the same
 * mid-motion slice AE rendered.
 */
export function aeCameraShot({
  cameraLayer,
  planeLayer,
  planeSourceSize,
  comp,
  shotStart,
  sensorHeight = 24,
  dofScale = 1,
}: AeCameraShotInput): AeCameraShot {
  const unit = comp.height;
  const posProp = aeProp(planeLayer, "Transform", "Position");
  const sclProp = aeProp(planeLayer, "Transform", "Scale");
  if (posProp?.keys?.length || sclProp?.keys?.length) {
    throw new Error(`aeCameraShot: plane layer "${planeLayer.name}" must have a static transform`);
  }
  for (const rotName of ["Rotation", "Orientation", "X Rotation", "Y Rotation", "Z Rotation"]) {
    const r = aeProp(planeLayer, "Transform", rotName);
    const v = r ? aeValue(r, shotStart) : null;
    const nonZero = Array.isArray(v) ? v.some((x) => Math.abs(x) > 1e-6) : typeof v === "number" && Math.abs(v) > 1e-6;
    if (nonZero) throw new Error(`aeCameraShot: plane layer "${planeLayer.name}" is rotated — unsupported`);
  }
  const planeCenter = asV3(posProp ? aeValue(posProp, shotStart) : null, [comp.width / 2, comp.height / 2, 0]);
  const scalePct = asV3(sclProp ? aeValue(sclProp, shotStart) : null, [100, 100, 100]);
  const planeSize: [number, number] = [
    (planeSourceSize[0] * scalePct[0]) / 100 / unit,
    (planeSourceSize[1] * scalePct[1]) / 100 / unit,
  ];

  // AE point → plane-relative renderer point
  const rel = (p: V3): V3 => [
    (p[0] - planeCenter[0]) / unit,
    (planeCenter[1] - p[1]) / unit,
    (planeCenter[2] - p[2]) / unit,
  ];

  const camPos = aeProp(cameraLayer, "Transform", "Position");
  const camPoi = aeProp(cameraLayer, "Transform", "Point of Interest");
  const zoom = aeProp(cameraLayer, "Camera Options", "Zoom");
  const focus = aeProp(cameraLayer, "Camera Options", "Focus Distance");
  const aperture = aeProp(cameraLayer, "Camera Options", "Aperture");
  const blurLevel = aeProp(cameraLayer, "Camera Options", "Blur Level");
  if (!camPos || !camPoi || !zoom) {
    throw new Error(`aeCameraShot: camera layer "${cameraLayer.name}" is missing Position/Point of Interest/Zoom`);
  }

  const keyTimes = new Set<number>();
  for (const p of [camPos, camPoi, zoom, focus, aperture, blurLevel]) {
    for (const k of p?.keys ?? []) keyTimes.add(k.time);
  }
  if (!keyTimes.size) keyTimes.add(shotStart);
  const times = [...keyTimes].sort((a, b) => a - b);

  const cameraKeyframes = times.map((t) => {
    const zoomPx = asNum(aeValue(zoom, t), unit);
    const aperturePx = aperture ? asNum(aeValue(aperture, t), 0) : 0;
    const blurPct = blurLevel ? asNum(aeValue(blurLevel, t), 100) : 100;
    const pose: VirtualCameraPose = {
      cameraPosition: rel(asV3(aeValue(camPos, t))),
      cameraTarget: rel(asV3(aeValue(camPoi, t))),
      focalLength: (sensorHeight * zoomPx) / unit,
      sensorHeight,
      // AE camera blur: coc_px = aperture · (blurLevel/100) · zoom · |1/focus − 1/z| (all px).
      // The renderer's thin-lens model computes coc in SCREEN PIXELS as
      // aperture · |1/f − 1/d| with f,d in world units (1 unit = compHeight px), so the exact
      // conversion is aperture · blur% · zoom / compHeight. Use dofModel="thinLens".
      depthOfField: (aperturePx * (blurPct / 100) * zoomPx * dofScale) / comp.height,
    };
    if (focus) pose.focusDistance = asNum(aeValue(focus, t), zoomPx) / unit;
    return { frame: (t - shotStart) * comp.frameRate, pose };
  });

  return { planeSize, cameraKeyframes };
}
