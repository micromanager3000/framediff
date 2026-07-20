import { describe, expect, it } from "vitest";
import type { InspectorFieldSnapshot, InspectorSectionSnapshot } from "@framediff/studio-model";
import {
  cameraFieldKey,
  cameraFieldMap,
  cameraFieldOfView,
  cameraFieldValue,
  cameraPoseAtFrame,
  cameraVectorEdits,
  cameraVectorKeys,
  cameraVectorValue,
} from "./CameraInspector.ViewModel";

const field = (key: string, value: number): InspectorFieldSnapshot => ({
  id: `data:src/camera.ts:CAMERAS:${key}`,
  label: key,
  value,
  editable: true,
});

const section: InspectorSectionSnapshot = {
  id: "camera:CAMERAS",
  title: "3D CAMERA + PLANE",
  kind: "camera",
  fields: [
    field("startFrame", 10), field("endFrame", 30),
    field("startCameraX", 0), field("startCameraY", 2), field("startCameraZ", 4),
    field("endCameraX", 10), field("endCameraY", 6), field("endCameraZ", 0),
    field("startTargetX", -2), field("startTargetY", 0), field("startTargetZ", 1),
    field("endTargetX", 2), field("endTargetY", 4), field("endTargetZ", 3),
    field("startFocusX", 0), field("startFocusY", 0), field("startFocusZ", 0),
    field("endFocusX", 4), field("endFocusY", 2), field("endFocusZ", -2),
    field("startFocalLength", 24), field("endFocalLength", 48),
    field("startFocusDistance", 2), field("endFocusDistance", 6),
    field("startDepthOfField", 100), field("endDepthOfField", 300),
    field("shutterAngle", 90), field("motionBlurSamples", 9),
  ],
};

describe("CameraInspector view model", () => {
  it("uses the source key instead of the human label", () => {
    expect(cameraFieldKey({ id: "data:file.ts:ROWS:endFocusDistance" })).toBe("endFocusDistance");
    const fields = cameraFieldMap(section);
    expect(cameraFieldValue(fields, "shutterAngle")).toBe(90);
    expect(cameraFieldValue(fields, "motionBlurSamples")).toBe(9);
  });

  it("shows a clamped, random-access pose at the current frame", () => {
    expect(cameraPoseAtFrame(section, -20).progress).toBe(0);
    expect(cameraPoseAtFrame(section, 80).progress).toBe(1);

    const pose = cameraPoseAtFrame(section, 20);
    expect(pose.progress).toBe(0.5);
    expect(pose.camera).toEqual([5, 4, 2]);
    expect(pose.target).toEqual([0, 2, 2]);
    expect(pose.focus).toEqual([2, 1, -1]);
    expect(pose.focalLength).toBe(36);
    expect(pose.focusDistance).toBe(4);
    expect(pose.depthOfField).toBe(200);
    expect(pose.fieldOfView).toBeCloseTo(cameraFieldOfView(36), 6);
  });

  it("handles missing optional source fields without breaking the inspector", () => {
    const pose = cameraPoseAtFrame({ fields: [field("startFrame", 4), field("endFrame", 4)] }, 4);
    expect(pose.progress).toBe(1);
    expect(pose.focalLength).toBe(50);
    expect(pose.focusDistance).toBe(0);
  });

  it("maps a 3D gizmo vector back to the endpoint's exact source fields", () => {
    const fields = cameraFieldMap(section);
    expect(cameraVectorKeys("end", "target")).toEqual(["endTargetX", "endTargetY", "endTargetZ"]);
    expect(cameraVectorValue(fields, "start", "camera")).toEqual([0, 2, 4]);
    expect(cameraVectorValue(fields, "end", "focus")).toEqual([4, 2, -2]);
    expect(cameraVectorValue(fields, "start", "plane")).toEqual([0, 0, 0]);
    expect(cameraVectorEdits(section, "start", "camera", [3, 2, 5])).toEqual([
      { fieldId: "data:src/camera.ts:CAMERAS:startCameraX", value: 3 },
      { fieldId: "data:src/camera.ts:CAMERAS:startCameraZ", value: 5 },
    ]);
  });
});
