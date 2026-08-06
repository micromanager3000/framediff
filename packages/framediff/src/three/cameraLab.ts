// The Camera Lab: hand-fly a three-scene comp's virtual camera and keyframe it in place.
//
// Opt in by giving `defineThreeSceneComposition` a `cameraFile` (project-relative JSON).
// The comp root becomes interactive (the Studio's overlay steps aside) and a small HUD
// mounts in the corner: toggle FLY, then drag to orbit, shift-drag to pan, wheel to
// dolly, alt-wheel to change focal length. ● KEY stamps the current pose at the playhead
// into the ACTIVE camera's track in the file (one key per frame, replace on re-key);
// ⨯ drops the key at the playhead; ↺ abandons the un-keyed draft pose.
//
// File keyframes OVERRIDE the scene's authored camera (per camera name), so a flown move
// is an ordinary reviewable diff and every deterministic renderer sees exactly what the
// Studio previewed. Without a dev server the file read fails soft → authored cameras.

import { readSource, writeSource } from "../studio/devfs";
import type { CameraKeyframe, CameraInterpolation, VirtualCameraPose } from "../effects/camera";

export interface CameraTrackFile {
  version: 1;
  cameras: Record<string, { interpolation?: CameraInterpolation; keyframes: CameraKeyframe[] }>;
}

export const parseCameraFile = (raw: string | null): CameraTrackFile => {
  if (!raw) return { version: 1, cameras: {} };
  try {
    const parsed = JSON.parse(raw) as CameraTrackFile;
    return { version: 1, cameras: parsed.cameras ?? {} };
  } catch {
    return { version: 1, cameras: {} };
  }
};

export const loadCameraFile = async (path: string): Promise<CameraTrackFile> =>
  parseCameraFile(await readSource(path).catch(() => null));

export interface CameraLabPose {
  eye: [number, number, number];
  target: [number, number, number];
  focalLength: number;
}

export interface CameraLabHooks {
  /** Latest playhead frame (comp frames). */
  frame: () => number;
  /** Camera name active at a frame (cut-aware). */
  cameraAt: (frame: number) => string | undefined;
  /** Pose the comp would render at a frame without the draft (file > code). */
  trackPose: (frame: number) => CameraLabPose;
  /** Ask the canvas to re-render with the current draft. */
  invalidate: () => void;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** Mount the HUD + pointer handlers. Returns the draft-pose getter (null = follow track). */
export function mountCameraLab(
  root: HTMLElement,
  file: { path: string; data: CameraTrackFile },
  hooks: CameraLabHooks,
): { draftPose: () => CameraLabPose | null; dispose: () => void } {
  const doc = root.ownerDocument;
  let flying = false;
  let draft: CameraLabPose | null = null;

  const hud = doc.createElement("div");
  hud.className = "fd-camera-lab";
  hud.style.cssText = [
    "position:absolute", "right:10px", "top:10px", "z-index:40", "display:flex", "gap:6px",
    "align-items:center", "font:600 11px ui-monospace,monospace", "color:#ddd5c4",
    "background:rgba(10,10,13,.82)", "border:1px solid rgba(242,236,223,.22)",
    "border-radius:8px", "padding:6px 8px", "pointer-events:auto", "user-select:none",
  ].join(";");
  const mkBtn = (label: string, title: string) => {
    const b = doc.createElement("button");
    b.textContent = label;
    b.title = title;
    b.style.cssText = "all:unset;cursor:pointer;padding:2px 7px;border:1px solid rgba(242,236,223,.25);border-radius:6px;";
    hud.appendChild(b);
    return b;
  };
  const who = doc.createElement("span");
  who.style.cssText = "opacity:.75;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  hud.appendChild(who);
  const fly = mkBtn("✛ FLY", "Toggle fly mode: drag orbit · shift-drag pan · wheel dolly · alt-wheel focal");
  const key = mkBtn("● KEY", "Write the current pose as a keyframe at the playhead");
  const drop = mkBtn("⨯", "Remove the keyframe at the playhead");
  const reset = mkBtn("↺", "Abandon the un-keyed draft and follow the track");
  const readout = doc.createElement("span");
  readout.style.cssText = "opacity:.6;font-weight:400";
  hud.appendChild(readout);
  root.appendChild(hud);
  // the comp root is usually scaled to fit the preview — counter-scale so the HUD
  // renders at UI size regardless of stage zoom
  const counterScale = () => {
    const rect = root.getBoundingClientRect();
    const s = rect.width > 0 && root.offsetWidth > 0 ? rect.width / root.offsetWidth : 1;
    hud.style.transformOrigin = "top right";
    hud.style.transform = `scale(${(1 / Math.max(0.05, s)).toFixed(4)})`;
  };
  counterScale();
  const scaleWatch = typeof ResizeObserver !== "undefined" ? new ResizeObserver(counterScale) : undefined;
  scaleWatch?.observe(root);

  const paint = () => {
    fly.style.background = flying ? "rgba(255,138,112,.25)" : "transparent";
    const name = hooks.cameraAt(hooks.frame()) ?? "—";
    const keyed = file.data.cameras[name]?.keyframes.length ?? 0;
    who.textContent = `${name}${keyed ? ` · ${keyed}k` : ""}`;
    if (draft) {
      const p = draft;
      readout.textContent = `${fmt(p.eye[0])},${fmt(p.eye[1])},${fmt(p.eye[2])} · ${Math.round(p.focalLength)}mm`;
    } else readout.textContent = "";
  };

  const ensureDraft = (): CameraLabPose => {
    if (!draft) draft = hooks.trackPose(hooks.frame());
    return draft;
  };

  fly.onclick = () => { flying = !flying; if (flying) ensureDraft(); paint(); hooks.invalidate(); };
  reset.onclick = () => { draft = null; paint(); hooks.invalidate(); };

  const save = () => writeSource(file.path, JSON.stringify(file.data, null, 2) + "\n");

  key.onclick = () => {
    const name = hooks.cameraAt(hooks.frame());
    if (!name) return;
    const pose = ensureDraft();
    const track = (file.data.cameras[name] ??= { interpolation: "ease", keyframes: [] });
    const frame = Math.round(hooks.frame());
    const kf: CameraKeyframe = {
      frame,
      pose: { cameraPosition: [...pose.eye], cameraTarget: [...pose.target], focalLength: pose.focalLength } as VirtualCameraPose,
    };
    const at = track.keyframes.findIndex((k) => k.frame === frame);
    if (at >= 0) track.keyframes[at] = kf;
    else track.keyframes.push(kf);
    track.keyframes.sort((a, b) => a.frame - b.frame);
    draft = null;
    void save();
    paint();
    hooks.invalidate();
  };

  drop.onclick = () => {
    const name = hooks.cameraAt(hooks.frame());
    const track = name ? file.data.cameras[name] : undefined;
    if (!track) return;
    const frame = Math.round(hooks.frame());
    track.keyframes = track.keyframes.filter((k) => k.frame !== frame);
    if (track.keyframes.length === 0) delete file.data.cameras[name!];
    void save();
    paint();
    hooks.invalidate();
  };

  // ---- fly-mode pointer math: orbit / pan / dolly / focal ----
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as [number, number, number];
  const add = (a: number[], b: number[]) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as [number, number, number];
  const scale = (a: number[], s: number) => [a[0] * s, a[1] * s, a[2] * s] as [number, number, number];
  const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
  const cross = (a: number[], b: number[]) =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] as [number, number, number];
  const norm = (a: [number, number, number]) => { const l = len(a) || 1; return scale(a, 1 / l); };

  let dragging = false;
  let panning = false;
  let last: [number, number] = [0, 0];
  const onDown = (e: PointerEvent) => {
    if (!flying || hud.contains(e.target as Node)) return;
    dragging = true;
    panning = e.shiftKey;
    last = [e.clientX, e.clientY];
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (!flying || !dragging) return;
    const dx = e.clientX - last[0];
    const dy = e.clientY - last[1];
    last = [e.clientX, e.clientY];
    const p = ensureDraft();
    const view = sub(p.target, p.eye);
    const dist = len(view);
    const fwd = norm(view as [number, number, number]);
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    if (panning) {
      const k = dist * 0.0016;
      const move = add(scale(right, -dx * k), scale(up, dy * k));
      p.eye = add(p.eye, move);
      p.target = add(p.target, move);
    } else {
      const yaw = -dx * 0.005;
      const pitch = -dy * 0.005;
      let off = sub(p.eye, p.target);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      off = [off[0] * cy + off[2] * sy, off[1], -off[0] * sy + off[2] * cy];
      const r = len(off);
      const el = Math.asin(Math.max(-1, Math.min(1, off[1] / r)));
      const az = Math.atan2(off[0], off[2]);
      const el2 = Math.max(-1.45, Math.min(1.45, el + pitch));
      off = [r * Math.cos(el2) * Math.sin(az), r * Math.sin(el2), r * Math.cos(el2) * Math.cos(az)];
      p.eye = add(p.target, off);
    }
    paint();
    hooks.invalidate();
    e.preventDefault();
  };
  const onUp = () => { dragging = false; };
  const onWheel = (e: WheelEvent) => {
    if (!flying) return;
    const p = ensureDraft();
    if (e.altKey) {
      p.focalLength = Math.max(10, Math.min(135, p.focalLength * (e.deltaY > 0 ? 0.96 : 1.045)));
    } else {
      const view = sub(p.target, p.eye);
      const dist = len(view);
      const next = Math.max(0.2, dist * (e.deltaY > 0 ? 1.06 : 0.943));
      p.eye = sub(p.target, scale(norm(view as [number, number, number]), next));
    }
    paint();
    hooks.invalidate();
    e.preventDefault();
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  paint();

  return {
    draftPose: () => (flying || draft ? draft : null),
    dispose: () => {
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("wheel", onWheel);
      scaleWatch?.disconnect();
      hud.remove();
    },
  };
}
