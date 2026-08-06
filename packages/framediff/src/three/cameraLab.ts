// Camera Lab: a compact, composition-native camera workstation for three-scene previz.
//
// A cameraFile opts a comp into direct camera authoring. The panel supports hand flying,
// exact lens/position/rotation values, visible frame-addressed keys, key navigation,
// interpolation, and reviewable JSON persistence. File keys override scene-authored cameras,
// so preview, bake, and render all evaluate the same deterministic track.

import { readSource, writeSource } from "../studio/devfs";
import type { V3 } from "../effects/mat4";
import type { CameraKeyframe, CameraInterpolation, VirtualCameraPose } from "../effects/camera";

export interface CameraTrackFile {
  version: 1;
  cameras: Record<string, { interpolation?: CameraInterpolation; keyframes: CameraKeyframe[] }>;
}

const finiteV3 = (value: unknown): value is V3 => Array.isArray(value)
  && value.length === 3
  && value.every((part) => typeof part === "number" && Number.isFinite(part));

const validKeyframe = (value: unknown): value is CameraKeyframe => {
  if (!value || typeof value !== "object") return false;
  const key = value as CameraKeyframe;
  return Number.isFinite(key.frame) && !!key.pose && typeof key.pose === "object";
};

export const parseCameraFile = (raw: string | null): CameraTrackFile => {
  if (!raw) return { version: 1, cameras: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<CameraTrackFile>;
    const cameras: CameraTrackFile["cameras"] = {};
    for (const [name, value] of Object.entries(parsed.cameras ?? {})) {
      if (!value || typeof value !== "object" || !Array.isArray(value.keyframes)) continue;
      cameras[name] = {
        ...(value.interpolation ? { interpolation: value.interpolation } : {}),
        keyframes: value.keyframes.filter(validKeyframe).sort((a, b) => a.frame - b.frame),
      };
    }
    return { version: 1, cameras };
  } catch {
    return { version: 1, cameras: {} };
  }
};

export const loadCameraFile = async (path: string): Promise<CameraTrackFile> =>
  parseCameraFile(await readSource(path).catch(() => null));

export async function persistCameraFile(
  path: string,
  data: CameraTrackFile,
  writer: (file: string, text: string) => Promise<boolean> = writeSource,
): Promise<void> {
  const saved = await writer(path, JSON.stringify(data, null, 2) + "\n");
  if (!saved) throw new Error(`Could not save camera keys to ${path}.`);
}

export interface CameraLabPose {
  eye: V3;
  target: V3;
  /** Pitch, yaw, roll in radians. */
  rotation: V3;
  focalLength: number;
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const length = (value: V3) => Math.hypot(value[0], value[1], value[2]);
const subtract = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (value: V3, factor: number): V3 => [value[0] * factor, value[1] * factor, value[2] * factor];
const normalized = (value: V3): V3 => scale(value, 1 / (length(value) || 1));
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const radiansToDegrees = (value: number): number => value * 180 / Math.PI;
export const degreesToRadians = (value: number): number => value * Math.PI / 180;

/** Derive pitch/yaw from a look-at pair. Roll remains independently editable. */
export function cameraRotationFromTarget(eye: V3, target: V3, roll = 0): V3 {
  const forward = normalized(subtract(target, eye));
  return [
    Math.asin(clamp(forward[1], -1, 1)),
    Math.atan2(-forward[0], -forward[2]),
    roll,
  ];
}

/** Project the camera's forward axis to a look-at point while preserving focus distance. */
export function cameraTargetFromRotation(eye: V3, rotation: V3, distance: number): V3 {
  const [pitch, yaw] = rotation;
  const forward: V3 = [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
  return add(eye, scale(forward, Math.max(0.001, distance)));
}

export function cameraLabPoseFromVirtual(pose: VirtualCameraPose, fallback: CameraLabPose): CameraLabPose {
  const eye = finiteV3(pose.cameraPosition) ? [...pose.cameraPosition] as V3 : [...fallback.eye] as V3;
  const authoredTarget = finiteV3(pose.cameraTarget) ? [...pose.cameraTarget] as V3 : undefined;
  const distance = authoredTarget ? length(subtract(authoredTarget, eye)) : length(subtract(fallback.target, fallback.eye));
  const rotation = finiteV3(pose.cameraRotation)
    ? [...pose.cameraRotation] as V3
    : cameraRotationFromTarget(eye, authoredTarget ?? fallback.target, fallback.rotation[2]);
  return {
    eye,
    rotation,
    target: authoredTarget ?? cameraTargetFromRotation(eye, rotation, distance),
    focalLength: typeof pose.focalLength === "number" && Number.isFinite(pose.focalLength)
      ? pose.focalLength
      : fallback.focalLength,
  };
}

export function cameraKeyframeFromPose(frame: number, pose: CameraLabPose): CameraKeyframe {
  return {
    frame: Math.round(frame),
    pose: {
      cameraPosition: [...pose.eye] as V3,
      cameraTarget: [...pose.target] as V3,
      cameraRotation: [...pose.rotation] as V3,
      focalLength: pose.focalLength,
    },
  };
}

export interface CameraLabHooks {
  /** Latest playhead frame (comp frames). */
  frame: () => number;
  durationInFrames: number;
  /** Camera name active at a frame (cut-aware). */
  cameraAt: (frame: number) => string | undefined;
  /** Pose the comp would render at a frame without the draft (file > code). */
  trackPose: (frame: number) => CameraLabPose;
  /** Ask the canvas to re-render with the current draft. */
  invalidate: () => void;
  /** Ask the Studio transport to move to a key. */
  seek?: (frame: number) => void;
}

const format = (value: number, digits = 2) => {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

/** Mount Camera Lab. The runtime calls sync() as the playhead advances. */
export function mountCameraLab(
  root: HTMLElement,
  file: { path: string; data: CameraTrackFile },
  hooks: CameraLabHooks,
): { draftPose: () => CameraLabPose | null; sync: () => void; dispose: () => void } {
  const doc = root.ownerDocument;
  let flying = false;
  let collapsed = false;
  let draft: CameraLabPose | null = null;
  let selectedCamera: string | null = null;
  let selectedFrame: number | null = null;
  let saving = false;
  let saveError: string | null = null;
  let savedPulse = false;
  let saveSequence = Promise.resolve();
  let markerSignature = "";

  const style = doc.createElement("style");
  style.textContent = `
    .fd-camera-lab{position:absolute;right:12px;top:12px;z-index:40;width:352px;color:#f3eee4;background:rgba(12,13,17,.94);border:1px solid rgba(244,237,224,.2);border-radius:14px;box-shadow:0 18px 54px rgba(0,0,0,.46);font:600 11px Inter,ui-sans-serif,system-ui,sans-serif;pointer-events:auto;user-select:none;overflow:hidden;backdrop-filter:blur(16px)}
    .fd-camera-lab *{box-sizing:border-box}.fd-camera-lab button,.fd-camera-lab input,.fd-camera-lab select{font:inherit}.fd-camera-lab button{border:0;color:inherit;background:transparent;cursor:pointer}.fd-camera-lab button:focus-visible,.fd-camera-lab input:focus-visible,.fd-camera-lab select:focus-visible{outline:2px solid #ffb36b;outline-offset:1px}
    .fd-cl-head{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:11px 12px;border-bottom:1px solid rgba(244,237,224,.12);background:rgba(255,255,255,.025)}.fd-cl-brand{display:flex;align-items:center;gap:9px;min-width:0}.fd-cl-aperture{width:25px;height:25px;display:grid;place-items:center;border-radius:50%;color:#111318;background:#ffb36b;font-size:13px}.fd-cl-title{min-width:0}.fd-cl-title b{display:block;font-size:10px;letter-spacing:.13em}.fd-cl-title span{display:block;overflow:hidden;margin-top:2px;color:#9e9a92;font:500 9px ui-monospace,monospace;text-overflow:ellipsis;white-space:nowrap}.fd-cl-collapse{width:26px;height:26px;border-radius:7px!important;color:#aaa59b!important}.fd-cl-collapse:hover{background:rgba(255,255,255,.08)}
    .fd-cl-body{padding:11px 12px 12px}.fd-camera-lab.is-collapsed .fd-cl-body{display:none}.fd-camera-lab.is-collapsed{width:250px}.fd-cl-actions{display:grid;grid-template-columns:72px 1fr 30px 30px;gap:6px}.fd-cl-action{height:30px;border:1px solid rgba(244,237,224,.15)!important;border-radius:8px!important;background:rgba(255,255,255,.035)!important;font-size:9px!important;letter-spacing:.06em}.fd-cl-action:hover{background:rgba(255,255,255,.08)!important}.fd-cl-action.primary{color:#151211;background:#ffb36b!important;border-color:#ffb36b!important;font-weight:800}.fd-cl-action.is-on{color:#ffb36b;background:rgba(255,179,107,.14)!important;border-color:rgba(255,179,107,.5)!important}.fd-cl-action:disabled{opacity:.35;cursor:default}
    .fd-cl-groups{display:grid;grid-template-columns:82px 1fr 1fr 1fr;gap:6px;margin-top:10px}.fd-cl-group-label{align-self:center;color:#7f7c76;font:700 8px ui-monospace,monospace;letter-spacing:.08em}.fd-cl-field{display:block}.fd-cl-field span{display:block;margin:0 0 4px;color:#88847d;font:700 8px ui-monospace,monospace;text-transform:uppercase}.fd-cl-field input{width:100%;height:27px;padding:0 7px;border:1px solid rgba(244,237,224,.13);border-radius:7px;color:#f3eee4;background:rgba(255,255,255,.045);font:600 10px ui-monospace,monospace}.fd-cl-field input:hover{border-color:rgba(244,237,224,.28)}.fd-cl-field input:focus{border-color:#ffb36b;background:#17171b}.fd-cl-lens{grid-column:2/5}.fd-cl-lens input{color:#ffcf9f}
    .fd-cl-divider{height:1px;margin:10px 0;background:rgba(244,237,224,.1)}.fd-cl-track-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.fd-cl-track-head span{color:#8d8981;font:700 8px ui-monospace,monospace;letter-spacing:.1em}.fd-cl-track-head select{height:24px;padding:0 22px 0 7px;border:1px solid rgba(244,237,224,.13);border-radius:6px;color:#bcb7ae;background:#17181d;font-size:8px}
    .fd-cl-track{position:relative;height:36px;border:1px solid rgba(244,237,224,.12);border-radius:8px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.018));overflow:hidden}.fd-cl-track:before{content:"";position:absolute;left:7px;right:7px;top:17px;height:1px;background:rgba(244,237,224,.16)}.fd-cl-playhead{position:absolute;top:4px;bottom:4px;width:1px;background:#ffb36b;box-shadow:0 0 8px rgba(255,179,107,.7);pointer-events:none}.fd-cl-playhead:before{content:"";position:absolute;left:-3px;top:-1px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #ffb36b}.fd-cl-markers{position:absolute;inset:0 7px}.fd-cl-marker{position:absolute!important;top:11px;width:13px;height:13px;margin-left:-6px;border:2px solid #79dbc8!important;background:#101217!important;transform:rotate(45deg);border-radius:2px!important}.fd-cl-marker:hover,.fd-cl-marker.is-selected{background:#79dbc8!important;box-shadow:0 0 0 3px rgba(121,219,200,.14)}
    .fd-cl-keyedit{display:grid;grid-template-columns:1fr 70px auto;gap:6px;align-items:center;margin-top:7px}.fd-cl-keyedit span{overflow:hidden;color:#9f9a92;font:600 9px ui-monospace,monospace;text-overflow:ellipsis;white-space:nowrap}.fd-cl-keyedit input{width:100%;height:26px;padding:0 7px;border:1px solid rgba(244,237,224,.13);border-radius:6px;color:#f3eee4;background:rgba(255,255,255,.045);font:600 9px ui-monospace,monospace}.fd-cl-delete{height:26px;padding:0 8px!important;border-radius:6px!important;color:#f29a91!important;background:rgba(242,154,145,.08)!important;font-size:8px!important}.fd-cl-delete:disabled{opacity:.28}
    .fd-cl-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;min-height:16px}.fd-cl-status{overflow:hidden;color:#77746e;font:600 8px ui-monospace,monospace;text-overflow:ellipsis;white-space:nowrap}.fd-cl-status.is-draft{color:#ffb36b}.fd-cl-status.is-error{color:#f29a91}.fd-cl-status.is-saved{color:#79dbc8}.fd-cl-help{color:#68655f;font:500 8px ui-monospace,monospace;white-space:nowrap}
  `;

  const hud = doc.createElement("section");
  hud.className = "fd-camera-lab";
  hud.setAttribute("aria-label", "Camera Lab");
  hud.appendChild(style);

  const head = doc.createElement("header");
  head.className = "fd-cl-head";
  const brand = doc.createElement("div");
  brand.className = "fd-cl-brand";
  const aperture = doc.createElement("span");
  aperture.className = "fd-cl-aperture";
  aperture.textContent = "◉";
  const title = doc.createElement("div");
  title.className = "fd-cl-title";
  const titleLabel = doc.createElement("b");
  titleLabel.textContent = "CAMERA LAB";
  const cameraLabel = doc.createElement("span");
  title.append(titleLabel, cameraLabel);
  brand.append(aperture, title);
  const collapseButton = doc.createElement("button");
  collapseButton.className = "fd-cl-collapse";
  collapseButton.type = "button";
  collapseButton.setAttribute("aria-label", "Collapse Camera Lab");
  collapseButton.textContent = "⌃";
  head.append(brand, collapseButton);
  hud.appendChild(head);

  const body = doc.createElement("div");
  body.className = "fd-cl-body";
  hud.appendChild(body);
  const actions = doc.createElement("div");
  actions.className = "fd-cl-actions";
  const button = (label: string, className: string, ariaLabel: string) => {
    const element = doc.createElement("button");
    element.type = "button";
    element.className = `fd-cl-action ${className}`.trim();
    element.textContent = label;
    element.setAttribute("aria-label", ariaLabel);
    return element;
  };
  const flyButton = button("✣ FLY", "", "Toggle camera fly controls");
  const keyButton = button("ADD KEY", "primary", "Add camera keyframe");
  const previousButton = button("‹", "", "Previous camera keyframe");
  const nextButton = button("›", "", "Next camera keyframe");
  actions.append(flyButton, keyButton, previousButton, nextButton);
  body.appendChild(actions);

  const fields = doc.createElement("div");
  fields.className = "fd-cl-groups";
  const inputs = new Map<string, HTMLInputElement>();
  const groupLabel = (text: string) => {
    const label = doc.createElement("div");
    label.className = "fd-cl-group-label";
    label.textContent = text;
    fields.appendChild(label);
  };
  const numberField = (key: string, labelText: string, step: string, className = "") => {
    const label = doc.createElement("label");
    label.className = `fd-cl-field ${className}`.trim();
    const caption = doc.createElement("span");
    caption.textContent = labelText;
    const input = doc.createElement("input");
    input.type = "number";
    input.step = step;
    input.setAttribute("aria-label", labelText);
    label.append(caption, input);
    fields.appendChild(label);
    inputs.set(key, input);
    return input;
  };
  groupLabel("LENS");
  const focalInput = numberField("focal", "Focal length (mm)", "1", "fd-cl-lens");
  focalInput.min = "8";
  focalInput.max = "300";
  groupLabel("POSITION");
  numberField("px", "Position X", "0.05");
  numberField("py", "Position Y", "0.05");
  numberField("pz", "Position Z", "0.05");
  groupLabel("ROTATION");
  numberField("rx", "Rotation X", "0.1");
  numberField("ry", "Rotation Y", "0.1");
  numberField("rz", "Rotation Z", "0.1");
  body.appendChild(fields);

  const divider = doc.createElement("div");
  divider.className = "fd-cl-divider";
  body.appendChild(divider);
  const trackHead = doc.createElement("div");
  trackHead.className = "fd-cl-track-head";
  const trackLabel = doc.createElement("span");
  trackLabel.textContent = "KEYFRAMES";
  const interpolation = doc.createElement("select");
  interpolation.setAttribute("aria-label", "Camera interpolation");
  for (const [value, label] of [["ease", "EASE"], ["linear", "LINEAR"], ["monotone", "SMOOTH PATH"]] as const) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    interpolation.appendChild(option);
  }
  trackHead.append(trackLabel, interpolation);
  body.appendChild(trackHead);

  const track = doc.createElement("div");
  track.className = "fd-cl-track";
  track.setAttribute("aria-label", "Camera keyframes");
  const markers = doc.createElement("div");
  markers.className = "fd-cl-markers";
  const playhead = doc.createElement("div");
  playhead.className = "fd-cl-playhead";
  track.append(markers, playhead);
  body.appendChild(track);

  const keyEdit = doc.createElement("div");
  keyEdit.className = "fd-cl-keyedit";
  const keySummary = doc.createElement("span");
  const frameInput = doc.createElement("input");
  frameInput.type = "number";
  frameInput.min = "0";
  frameInput.max = String(Math.max(0, hooks.durationInFrames - 1));
  frameInput.step = "1";
  frameInput.setAttribute("aria-label", "Selected keyframe frame");
  const deleteButton = doc.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "fd-cl-delete";
  deleteButton.textContent = "DELETE";
  deleteButton.setAttribute("aria-label", "Delete selected camera keyframe");
  keyEdit.append(keySummary, frameInput, deleteButton);
  body.appendChild(keyEdit);

  const foot = doc.createElement("div");
  foot.className = "fd-cl-foot";
  const status = doc.createElement("span");
  status.className = "fd-cl-status";
  const help = doc.createElement("span");
  help.className = "fd-cl-help";
  help.textContent = "drag orbit · ⇧ drag pan · wheel dolly";
  foot.append(status, help);
  body.appendChild(foot);
  root.appendChild(hud);

  const currentName = () => hooks.cameraAt(hooks.frame()) ?? "camera";
  const currentTrack = () => file.data.cameras[currentName()];
  const sortedKeys = () => [...(currentTrack()?.keyframes ?? [])].sort((a, b) => a.frame - b.frame);
  const selectedKey = () => {
    if (selectedFrame == null || selectedCamera !== currentName()) return undefined;
    return currentTrack()?.keyframes.find((entry) => entry.frame === selectedFrame);
  };
  const poseForKey = (key: CameraKeyframe, name = currentName()): CameraLabPose => {
    const fallback = hooks.trackPose(key.frame);
    return cameraLabPoseFromVirtual(key.pose, fallback);
  };
  const ensureDraft = (): CameraLabPose => {
    if (!draft) {
      const chosen = selectedKey();
      draft = chosen ? poseForKey(chosen) : hooks.trackPose(hooks.frame());
    }
    return draft;
  };
  const updateTargetFromRotation = (pose: CameraLabPose) => {
    const distance = length(subtract(pose.target, pose.eye));
    pose.target = cameraTargetFromRotation(pose.eye, pose.rotation, distance);
  };

  const queueSave = () => {
    const snapshot = parseCameraFile(JSON.stringify(file.data));
    saving = true;
    saveError = null;
    savedPulse = false;
    paint();
    saveSequence = saveSequence
      .catch(() => undefined)
      .then(() => persistCameraFile(file.path, snapshot));
    void saveSequence.then(() => {
      saving = false;
      savedPulse = true;
      paint();
      globalThis.setTimeout(() => { savedPulse = false; paint(); }, 1200);
    }).catch((error) => {
      saving = false;
      saveError = error instanceof Error ? error.message : String(error);
      paint();
    });
  };

  const chooseKey = (key: CameraKeyframe) => {
    selectedCamera = currentName();
    selectedFrame = key.frame;
    draft = poseForKey(key);
    hooks.seek?.(key.frame);
    hooks.invalidate();
    paint();
  };

  const rebuildMarkers = (keys: CameraKeyframe[]) => {
    const signature = `${currentName()}:${keys.map((entry) => entry.frame).join(",")}:${selectedFrame ?? ""}`;
    if (signature === markerSignature) return;
    markerSignature = signature;
    markers.replaceChildren();
    const span = Math.max(1, hooks.durationInFrames - 1);
    keys.forEach((entry, index) => {
      const marker = doc.createElement("button");
      marker.type = "button";
      marker.className = "fd-cl-marker";
      marker.classList.toggle("is-selected", selectedCamera === currentName() && selectedFrame === entry.frame);
      marker.style.left = `${clamp(entry.frame / span, 0, 1) * 100}%`;
      marker.setAttribute("aria-label", `Camera keyframe ${index + 1} at frame ${entry.frame}`);
      marker.title = `Key ${index + 1} · frame ${entry.frame}`;
      marker.onclick = () => chooseKey(entry);
      markers.appendChild(marker);
    });
  };

  function paint() {
    const frame = hooks.frame();
    const name = currentName();
    if (selectedCamera && selectedCamera !== name) {
      selectedCamera = null;
      selectedFrame = null;
      draft = null;
    }
    const keys = sortedKeys();
    const chosen = selectedKey();
    const shownPose = draft ?? (chosen ? poseForKey(chosen) : hooks.trackPose(frame));
    cameraLabel.textContent = `${name} · ${Math.round(frame)}f · ${keys.length} key${keys.length === 1 ? "" : "s"}`;
    hud.classList.toggle("is-collapsed", collapsed);
    collapseButton.textContent = collapsed ? "⌄" : "⌃";
    collapseButton.setAttribute("aria-label", collapsed ? "Expand Camera Lab" : "Collapse Camera Lab");
    flyButton.classList.toggle("is-on", flying);
    flyButton.textContent = flying ? "✣ FLYING" : "✣ FLY";
    const keyAtFrame = currentTrack()?.keyframes.find((entry) => entry.frame === Math.round(frame));
    keyButton.textContent = chosen || keyAtFrame ? "UPDATE KEY" : "ADD KEY";
    previousButton.disabled = keys.length === 0;
    nextButton.disabled = keys.length === 0;
    interpolation.value = currentTrack()?.interpolation ?? "ease";
    const values: Record<string, number> = {
      focal: shownPose.focalLength,
      px: shownPose.eye[0], py: shownPose.eye[1], pz: shownPose.eye[2],
      rx: radiansToDegrees(shownPose.rotation[0]),
      ry: radiansToDegrees(shownPose.rotation[1]),
      rz: radiansToDegrees(shownPose.rotation[2]),
    };
    for (const [key, input] of inputs) if (doc.activeElement !== input) input.value = format(values[key]);
    playhead.style.left = `${clamp(frame / Math.max(1, hooks.durationInFrames - 1), 0, 1) * 100}%`;
    rebuildMarkers(keys);
    if (chosen) {
      const index = keys.findIndex((entry) => entry.frame === chosen.frame);
      keySummary.textContent = `KEY ${index + 1} OF ${keys.length}`;
      if (doc.activeElement !== frameInput) frameInput.value = String(chosen.frame);
      frameInput.disabled = false;
      deleteButton.disabled = false;
    } else {
      keySummary.textContent = keys.length ? `${keys.length} KEYS · SELECT A MARKER` : "NO KEYS YET";
      if (doc.activeElement !== frameInput) frameInput.value = String(Math.round(frame));
      frameInput.disabled = true;
      deleteButton.disabled = !keyAtFrame;
    }
    status.className = "fd-cl-status";
    if (saveError) { status.textContent = saveError; status.classList.add("is-error"); }
    else if (saving) status.textContent = `SAVING ${file.path}…`;
    else if (savedPulse) { status.textContent = "CAMERA KEYS SAVED"; status.classList.add("is-saved"); }
    else if (draft) { status.textContent = chosen ? `EDITING KEY ${chosen.frame} · UPDATE TO SAVE` : "UNSAVED CAMERA DRAFT · ADD KEY TO SAVE"; status.classList.add("is-draft"); }
    else status.textContent = `JSON · ${file.path}`;
  }

  const updateNumber = (key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    const pose = ensureDraft();
    if (key === "focal") pose.focalLength = clamp(value, 8, 300);
    else if (key === "px" || key === "py" || key === "pz") {
      pose.eye[key === "px" ? 0 : key === "py" ? 1 : 2] = value;
      updateTargetFromRotation(pose);
    } else {
      pose.rotation[key === "rx" ? 0 : key === "ry" ? 1 : 2] = degreesToRadians(value);
      updateTargetFromRotation(pose);
    }
    saveError = null;
    paint();
    hooks.invalidate();
  };
  for (const [key, input] of inputs) input.oninput = () => updateNumber(key, input.valueAsNumber);

  collapseButton.onclick = () => { collapsed = !collapsed; paint(); };
  flyButton.onclick = () => { flying = !flying; if (flying) ensureDraft(); paint(); hooks.invalidate(); };
  keyButton.onclick = () => {
    const name = currentName();
    const trackData = (file.data.cameras[name] ??= { interpolation: "ease", keyframes: [] });
    const frame = selectedCamera === name && selectedFrame != null ? selectedFrame : Math.round(hooks.frame());
    const pose = ensureDraft();
    const keyframe = cameraKeyframeFromPose(frame, pose);
    const index = trackData.keyframes.findIndex((entry) => entry.frame === frame);
    if (index >= 0) trackData.keyframes[index] = keyframe;
    else trackData.keyframes.push(keyframe);
    trackData.keyframes.sort((a, b) => a.frame - b.frame);
    selectedCamera = name;
    selectedFrame = frame;
    draft = null;
    markerSignature = "";
    queueSave();
    hooks.invalidate();
  };
  const stepKey = (direction: -1 | 1) => {
    const keys = sortedKeys();
    if (!keys.length) return;
    const frame = selectedFrame ?? hooks.frame();
    const candidate = direction < 0
      ? [...keys].reverse().find((entry) => entry.frame < frame) ?? keys.at(-1)!
      : keys.find((entry) => entry.frame > frame) ?? keys[0];
    chooseKey(candidate);
  };
  previousButton.onclick = () => stepKey(-1);
  nextButton.onclick = () => stepKey(1);
  deleteButton.onclick = () => {
    const name = currentName();
    const trackData = file.data.cameras[name];
    if (!trackData) return;
    const frame = selectedCamera === name && selectedFrame != null ? selectedFrame : Math.round(hooks.frame());
    trackData.keyframes = trackData.keyframes.filter((entry) => entry.frame !== frame);
    if (!trackData.keyframes.length) delete file.data.cameras[name];
    selectedFrame = null;
    selectedCamera = null;
    draft = null;
    markerSignature = "";
    queueSave();
    hooks.invalidate();
  };
  frameInput.onchange = () => {
    const chosen = selectedKey();
    const trackData = currentTrack();
    if (!chosen || !trackData || !Number.isFinite(frameInput.valueAsNumber)) return;
    const next = Math.round(clamp(frameInput.valueAsNumber, 0, Math.max(0, hooks.durationInFrames - 1)));
    chosen.frame = next;
    trackData.keyframes = trackData.keyframes.filter((entry, index, all) =>
      entry === chosen || all.findIndex((candidate) => candidate.frame === entry.frame) === index);
    trackData.keyframes.sort((a, b) => a.frame - b.frame);
    selectedFrame = next;
    markerSignature = "";
    hooks.seek?.(next);
    queueSave();
    hooks.invalidate();
  };
  interpolation.onchange = () => {
    const name = currentName();
    const trackData = (file.data.cameras[name] ??= { keyframes: [] });
    trackData.interpolation = interpolation.value as CameraInterpolation;
    queueSave();
    hooks.invalidate();
  };

  // Fly controls: orbit / pan / dolly. Numeric rotation remains authoritative after each move.
  let dragging = false;
  let panning = false;
  let lastPointer: [number, number] = [0, 0];
  const onPointerDown = (event: PointerEvent) => {
    if (!flying || hud.contains(event.target as Node)) return;
    dragging = true;
    panning = event.shiftKey;
    lastPointer = [event.clientX, event.clientY];
    root.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!flying || !dragging) return;
    const dx = event.clientX - lastPointer[0];
    const dy = event.clientY - lastPointer[1];
    lastPointer = [event.clientX, event.clientY];
    const pose = ensureDraft();
    const view = subtract(pose.target, pose.eye);
    const distance = length(view);
    const forward = normalized(view);
    const right = normalized(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    if (panning) {
      const factor = distance * 0.0016;
      const movement = add(scale(right, -dx * factor), scale(up, dy * factor));
      pose.eye = add(pose.eye, movement);
      pose.target = add(pose.target, movement);
    } else {
      const yaw = -dx * 0.005;
      const pitch = -dy * 0.005;
      let offset = subtract(pose.eye, pose.target);
      const cosine = Math.cos(yaw);
      const sine = Math.sin(yaw);
      offset = [offset[0] * cosine + offset[2] * sine, offset[1], -offset[0] * sine + offset[2] * cosine];
      const radius = length(offset);
      const elevation = Math.asin(clamp(offset[1] / radius, -1, 1));
      const azimuth = Math.atan2(offset[0], offset[2]);
      const nextElevation = clamp(elevation + pitch, -1.45, 1.45);
      offset = [
        radius * Math.cos(nextElevation) * Math.sin(azimuth),
        radius * Math.sin(nextElevation),
        radius * Math.cos(nextElevation) * Math.cos(azimuth),
      ];
      pose.eye = add(pose.target, offset);
      pose.rotation = cameraRotationFromTarget(pose.eye, pose.target, pose.rotation[2]);
    }
    paint();
    hooks.invalidate();
    event.preventDefault();
  };
  const onPointerUp = () => { dragging = false; };
  const onWheel = (event: WheelEvent) => {
    if (!flying || hud.contains(event.target as Node)) return;
    const pose = ensureDraft();
    if (event.altKey) pose.focalLength = clamp(pose.focalLength * (event.deltaY > 0 ? 0.96 : 1.045), 8, 300);
    else {
      const distance = length(subtract(pose.target, pose.eye));
      const next = Math.max(0.2, distance * (event.deltaY > 0 ? 1.06 : 0.943));
      pose.eye = subtract(pose.target, scale(normalized(subtract(pose.target, pose.eye)), next));
    }
    paint();
    hooks.invalidate();
    event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key.toLowerCase() === "f") { flyButton.click(); event.preventDefault(); }
    else if (event.key.toLowerCase() === "k") { keyButton.click(); event.preventDefault(); }
    else if (event.key === "Escape") { draft = null; selectedFrame = null; selectedCamera = null; paint(); hooks.invalidate(); }
  };
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("keydown", onKeyDown);
  if (!root.hasAttribute("tabindex")) root.tabIndex = 0;

  const counterScale = () => {
    const rect = root.getBoundingClientRect();
    const scaleValue = rect.width > 0 && root.offsetWidth > 0 ? rect.width / root.offsetWidth : 1;
    hud.style.transformOrigin = "top right";
    hud.style.transform = `scale(${(1 / Math.max(0.05, scaleValue)).toFixed(4)})`;
  };
  counterScale();
  const scaleWatch = typeof ResizeObserver !== "undefined" ? new ResizeObserver(counterScale) : undefined;
  scaleWatch?.observe(root);
  paint();

  return {
    draftPose: () => draft,
    sync: paint,
    dispose: () => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("keydown", onKeyDown);
      scaleWatch?.disconnect();
      hud.remove();
    },
  };
}
