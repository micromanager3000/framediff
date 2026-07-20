/** Canonical editable fields for the data-driven virtual-camera inspector. */
export const CAMERA3D_FIELD_KEYS = [
  "startCameraX", "startCameraY", "startCameraZ",
  "endCameraX", "endCameraY", "endCameraZ",
  "startTargetX", "startTargetY", "startTargetZ",
  "endTargetX", "endTargetY", "endTargetZ",
  "startFocalLength", "endFocalLength",
  "startFocusX", "startFocusY", "startFocusZ",
  "endFocusX", "endFocusY", "endFocusZ",
  "startFocusDistance", "endFocusDistance",
  "startDepthOfField", "endDepthOfField",
  "startFrame", "endFrame",
  "planeW", "planeH",
  "planeX", "planeY", "planeZ",
  "planeScale",
  "planeRotXDeg", "planeRotYDeg", "planeRotZDeg",
  "maxBlur",
  "shutterAngle", "motionBlurSamples",
] as const;
