import type { InspectorFieldSnapshot, InspectorSectionSnapshot } from "@framediff/studio-model";

export type CameraEndpoint = "start" | "end";
export type CameraRigHandle = "camera" | "target" | "focus" | "plane";
export type CameraVector = [number, number, number];

export interface CameraPoseSnapshot {
  startFrame: number;
  endFrame: number;
  progress: number;
  camera: [number, number, number];
  target: [number, number, number];
  focus: [number, number, number];
  focalLength: number;
  fieldOfView: number;
  focusDistance: number;
  depthOfField: number;
}

/** Extracts the stable source key without depending on the field's display label. */
export function cameraFieldKey(field: Pick<InspectorFieldSnapshot, "id">): string {
  const raw = field.id.slice(field.id.lastIndexOf(":") + 1);
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* malformed external IDs stay literal */ }
  return decoded.split("/").filter(Boolean).at(-1) ?? decoded;
}

export function cameraFieldMap(section: Pick<InspectorSectionSnapshot, "fields">): Map<string, InspectorFieldSnapshot> {
  return new Map(section.fields.map((field) => [cameraFieldKey(field), field]));
}

export function cameraFieldValue(
  fields: ReadonlyMap<string, InspectorFieldSnapshot>,
  key: string,
  fallback = 0,
): number {
  const field = fields.get(key);
  const value = field?.control?.type === "number" ? field.control.value : field?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function cameraFieldOfView(focalLength: number, sensorHeight = 24): number {
  if (focalLength <= 0 || sensorHeight <= 0) return 0;
  return 2 * Math.atan(sensorHeight / (2 * focalLength)) * 180 / Math.PI;
}

function mix(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}

function endpointValue(
  fields: ReadonlyMap<string, InspectorFieldSnapshot>,
  endpoint: CameraEndpoint,
  suffix: string,
  fallback = 0,
): number {
  return cameraFieldValue(fields, `${endpoint}${suffix}`, fallback);
}

export function cameraVectorKeys(endpoint: CameraEndpoint, handle: CameraRigHandle): [string, string, string] {
  if (handle === "plane") return ["planeX", "planeY", "planeZ"];
  const suffix = handle === "camera" ? "Camera" : handle === "target" ? "Target" : "Focus";
  return ["X", "Y", "Z"].map((axis) => `${endpoint}${suffix}${axis}`) as [string, string, string];
}

export function cameraVectorValue(
  fields: ReadonlyMap<string, InspectorFieldSnapshot>,
  endpoint: CameraEndpoint,
  handle: CameraRigHandle,
): CameraVector {
  return cameraVectorKeys(endpoint, handle).map((key) => cameraFieldValue(fields, key)) as CameraVector;
}

export function cameraVectorEdits(
  section: Pick<InspectorSectionSnapshot, "fields">,
  endpoint: CameraEndpoint,
  handle: CameraRigHandle,
  vector: CameraVector,
): Array<{ fieldId: string; value: number }> {
  const fields = cameraFieldMap(section);
  return cameraVectorKeys(endpoint, handle).flatMap((key, index) => {
    const field = fields.get(key);
    const value = vector[index];
    return field?.editable && Number.isFinite(value) && Math.abs(cameraFieldValue(fields, key) - value) > 1e-9
      ? [{ fieldId: field.id, value }]
      : [];
  });
}

function interpolated(
  fields: ReadonlyMap<string, InspectorFieldSnapshot>,
  suffix: string,
  progress: number,
  fallback = 0,
): number {
  return mix(endpointValue(fields, "start", suffix, fallback), endpointValue(fields, "end", suffix, fallback), progress);
}

/** A clear linear readout of the authored endpoints at the current frame.
 *  The composition may apply a fitted easing curve at render time; that curve remains code authority.
 */
export function cameraPoseAtFrame(
  section: Pick<InspectorSectionSnapshot, "fields">,
  frame: number,
): CameraPoseSnapshot {
  const fields = cameraFieldMap(section);
  const startFrame = cameraFieldValue(fields, "startFrame");
  const endFrame = cameraFieldValue(fields, "endFrame", startFrame + 1);
  const duration = endFrame - startFrame;
  const progress = duration === 0 ? 1 : Math.max(0, Math.min(1, (frame - startFrame) / duration));
  const focalLength = interpolated(fields, "FocalLength", progress, 50);
  return {
    startFrame,
    endFrame,
    progress,
    camera: ["X", "Y", "Z"].map((axis) => interpolated(fields, `Camera${axis}`, progress)) as [number, number, number],
    target: ["X", "Y", "Z"].map((axis) => interpolated(fields, `Target${axis}`, progress)) as [number, number, number],
    focus: ["X", "Y", "Z"].map((axis) => interpolated(fields, `Focus${axis}`, progress)) as [number, number, number],
    focalLength,
    fieldOfView: cameraFieldOfView(focalLength),
    focusDistance: interpolated(fields, "FocusDistance", progress),
    depthOfField: interpolated(fields, "DepthOfField", progress),
  };
}
