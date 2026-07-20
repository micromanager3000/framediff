// GENERATED from ae/aep-dump.json by scripts/derive-from-aep.ts — regenerate with:
//   node scripts/derive-from-aep.ts
// Studio gestures may rewrite these literals; regenerating restores the AEP-exact values.
// Times are LightTwist comp frames @ 23.9759979248047 fps; world units: 1 = comp height (1080 px).

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

export const AE_META = { fps: 23.9759979248047, width: 1920, height: 1080, durationInFrames: 971 } as const;

/** Single-layer shots: the recovered cut list (visibility-resolved, top-most layer wins). */
export const AE_EDL: AeEdlRow[] = [
  {name: "open", layerIndex: 46, sourceName: "NANDO_FX3_0023.mp4", from: 0, durationInFrames: 44, srcIn: 3.4006, rate: 0.9, anchor: [1920, 1080], srcW: 3840, srcH: 2160, f0: -19.98, f1: 42.956, pos0: [960, 540], pos1: [1020, 630], scale0: 50, scale1: 60, ease: "linear"},
  {name: "phone", layerIndex: 47, sourceName: "NANDO_FX3_0030.mp4", from: 44, durationInFrames: 47, srcIn: 4.9484, rate: 1, anchor: [1920, 1080], srcW: 3840, srcH: 2160, f0: -1.043, f1: 87.868, pos0: [450, 459], pos1: [264, 399], scale0: 77, scale1: 87, ease: "linear"},
  {name: "news_a", layerIndex: 38, sourceName: "latest2ar2_lighttwistnewsroom-2026-06-17-21-40-53.mp4", from: 145, durationInFrames: 118, srcIn: 5.4638, rate: 1, anchor: [960, 544], srcW: 1920, srcH: 1088, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 100, ease: "linear"},
  {name: "news_b", layerIndex: 37, sourceName: "latest2ar2_lighttwistnewsroom-2026-06-17-21-40-53.mp4", from: 263, durationInFrames: 34, srcIn: 13.9306, rate: 1, anchor: [960, 544], srcW: 1920, srcH: 1088, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 100, ease: "linear"},
  {name: "news_c", layerIndex: 36, sourceName: "latest2ar2_lighttwistnewsroom-2026-06-17-21-40-53.mp4", from: 297, durationInFrames: 51, srcIn: 15.4738, rate: 1, anchor: [960, 544], srcW: 1920, srcH: 1088, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 100, ease: "linear"},
  {name: "uizoom", layerIndex: 35, sourceName: "Screen Recording 2026-06-17 at 3.52.13 PM.mov", from: 348, durationInFrames: 58, srcIn: 0, rate: 1, anchor: [1644, 1120], srcW: 3288, srcH: 2240, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 48, scale1: 48, ease: "linear"},
  {name: "june3d", layerIndex: 33, sourceName: "2026-06-15 17-29-58.mp4", from: 406, durationInFrames: 41, srcIn: 28.175, rate: 1, anchor: [1512, 982], srcW: 3024, srcH: 1964, f0: 0, f1: 0, pos0: [1261.53, 209.789], pos1: [1261.53, 209.789], scale0: 120.68, scale1: 120.68, ease: "linear"},
  {name: "cam4", layerIndex: 29, sourceName: "explicacao-interface-nova.mp4 Comp 2", from: 490, durationInFrames: 28, srcIn: 736.65, rate: 1, anchor: [1512, 982], srcW: 3024, srcH: 1964, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 100, ease: "linear"},
  {name: "hf_talk", layerIndex: 20, sourceName: "hf_20260617_191556_e93008c8-2fd0-4ce8-bdd9-1b6b52ead4a0.mp4", from: 606, durationInFrames: 17, srcIn: 2.8338, rate: 1, anchor: [960, 540], srcW: 1920, srcH: 1080, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 102.045, scale1: 102.045, ease: "linear"},
  {name: "magnific", layerIndex: 19, sourceName: "magnific_video-upscale_3009454435.mp4", from: 623, durationInFrames: 16, srcIn: 1.2085, rate: 1, anchor: [1273, 719], srcW: 2546, srcH: 1438, f0: -6.998, f1: 15.979, pos0: [960, 540], pos1: [960, 540], scale0: 77, scale1: 80, ease: "linear"},
  {name: "cam6", layerIndex: 18, sourceName: "explicacao-interface-nova.mp4", from: 639, durationInFrames: 22, srcIn: 187.4917, rate: 1, anchor: [1512, 982], srcW: 3024, srcH: 1964, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 100, ease: "linear"},
  {name: "greenwide", layerIndex: 16, sourceName: "kling_20260527_作品_gerar_uma__2957_0_prob4.mov", from: 661, durationInFrames: 14, srcIn: 1.0833, rate: 1, anchor: [1920, 1080], srcW: 3840, srcH: 2160, f0: 0, f1: 0, pos0: [1020, 576], pos1: [1020, 576], scale0: 55, scale1: 55, ease: "linear"},
  {name: "greentrack", layerIndex: 15, sourceName: "kling_20260527_作品_gerar_uma__2957_0_prob4.mov Comp 1", from: 675, durationInFrames: 18, srcIn: 1.6667, rate: 1, anchor: [1920, 1080], srcW: 3840, srcH: 2160, f0: 0, f1: 0, pos0: [1020, 576], pos1: [1020, 576], scale0: 55, scale1: 55, ease: "linear"},
  {name: "desk", layerIndex: 14, sourceName: "2026-04-24 13-52-20.mp4", from: 693, durationInFrames: 26, srcIn: 45.8869, rate: 1, anchor: [960, 540], srcW: 1920, srcH: 1080, f0: -9.989, f1: 23.977, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 103, ease: "linear"},
  {name: "smartest", layerIndex: 13, sourceName: "latest2br1_SmartestPerson_Standalone-2026-05-12-13-47-09.mp4", from: 719, durationInFrames: 24, srcIn: 35.158, rate: 1, anchor: [960, 544], srcW: 1920, srcH: 1088, f0: -0.792, f1: 32.175, pos0: [960, 540], pos1: [960, 513], scale0: 100, scale1: 105, ease: "linear"},
  {name: "blazer", layerIndex: 12, sourceName: "kling_20260527_作品_animar_as__5514_0_prob4.mov", from: 743, durationInFrames: 20, srcIn: -0.0076, rate: 1, anchor: [1920, 1080], srcW: 3840, srcH: 2160, f0: 0, f1: 0, pos0: [1020, 579], pos1: [1020, 579], scale0: 54, scale1: 54, ease: "linear"},
  {name: "tripod_a", layerIndex: 11, sourceName: "2026-04-24 13-57-01.mp4", from: 763, durationInFrames: 19, srcIn: 15.9039, rate: 1, anchor: [960, 540], srcW: 1920, srcH: 1080, f0: 0.164, f1: 28.136, pos0: [960, 540], pos1: [954, 531], scale0: 100, scale1: 106, ease: "linear"},
  {name: "tripod_b", layerIndex: 10, sourceName: "2026-04-24 13-57-01.mp4", from: 782, durationInFrames: 26, srcIn: 17.445, rate: 1.2346, anchor: [960, 540], srcW: 1920, srcH: 1080, f0: -4.851, f1: 29.275, pos0: [960, 540], pos1: [954, 531], scale0: 100, scale1: 106, ease: "linear"},
  {name: "keynote_b", layerIndex: 9, sourceName: "latest2ar2_bright-keynote-2026-06-15-16-01-50.mp4", from: 808, durationInFrames: 34, srcIn: 11.5413, rate: 1, anchor: [960, 544], srcW: 1920, srcH: 1088, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 100, ease: "linear"},
];

/** The grid moment (stream feio precomp ×2): bottom pane first; darkFill = silhouette copy. */
export const AE_GRID: AePaneRow[] = [
  {name: "grid_0", layerIndex: 43, sourceName: "stream feio.mp4 Comp 1", from: 91, durationInFrames: 54, srcIn: 2.9621, rate: 1, darkFill: true, anchor: [1920, 1080], srcW: 3840, srcH: 2160, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 50, scale1: 50, ease: "linear"},
  {name: "grid_1", layerIndex: 42, sourceName: "stream feio.mp4 Comp 1", from: 94, durationInFrames: 51, srcIn: 2.9623, rate: 1, darkFill: false, anchor: [1920, 1080], srcW: 3840, srcH: 2160, f0: -0.094, f1: 60.845, pos0: [960, 540], pos1: [960, 540], scale0: 50, scale1: 52, ease: "linear"},
];

/** The split moment (hf left + 13-35-32 right), masks slide with the position keys. */
export const AE_SPLIT: AePaneRow[] = [
  {name: "split_0", layerIndex: 31, sourceName: "hf_20260617_193427_539e8457-d7ac-46a5-b9c8-c8b90271c001.mp4", from: 447, durationInFrames: 43, srcIn: 1.3333, rate: 1, darkFill: false, anchor: [960, 540], srcW: 1920, srcH: 1080, f0: -6.993, f1: 32.967, pos0: [960, 540], pos1: [490, 540], scale0: 100, scale1: 100, ease: "smooth"},
  {name: "split_1", layerIndex: 30, sourceName: "2026-04-24 13-35-32.mp4", from: 447, durationInFrames: 43, srcIn: 7.625, rate: 1, darkFill: false, anchor: [960, 540], srcW: 1920, srcH: 1080, f0: -6.993, f1: 32.967, pos0: [2144, 540], pos1: [1764, 540], scale0: 100, scale1: 100, ease: "smooth"},
];

/** The keynote moment: three stacked panes of the same source at different src-ins. */
export const AE_KEYNOTE: AePaneRow[] = [
  {name: "keynote_0", layerIndex: 25, sourceName: "latest2ar2_bright-keynote-2026-06-15-16-12-27.mp4", from: 518, durationInFrames: 56, srcIn: 4.5662, rate: 1, darkFill: true, anchor: [960, 544], srcW: 1920, srcH: 1088, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 100, ease: "linear"},
  {name: "keynote_1", layerIndex: 24, sourceName: "latest2ar2_bright-keynote-2026-06-15-16-12-27.mp4", from: 520, durationInFrames: 31, srcIn: 5.0573, rate: 1, darkFill: false, anchor: [960, 544], srcW: 1920, srcH: 1088, f0: 0, f1: 0, pos0: [960, 540], pos1: [960, 540], scale0: 100, scale1: 100, ease: "linear"},
  {name: "keynote_2", layerIndex: 23, sourceName: "latest2ar2_bright-keynote-2026-06-15-16-12-27.mp4", from: 551, durationInFrames: 23, srcIn: 9.8955, rate: 1, darkFill: false, anchor: [960, 1084], srcW: 1920, srcH: 1088, f0: 0, f1: 0, pos0: [992, 1080], pos1: [992, 1080], scale0: 108, scale1: 108, ease: "linear"},
];

/** The four AE 3D-camera shots in the camera3d rig convention (plane-relative world units).
 *  start/endFrame are fractional frames relative to each shot's window — they may lie outside
 *  it: the visible move is a mid-motion slice of the smoothstep-eased curve, exactly like AE. */
export const AE_PLANE_CAMERA_MOVES = [
  {name: "uizoom", startFrame: 0, endFrame: 57, startCameraX: -0.663265, startCameraY: -0.004274, startCameraZ: 2.8, endCameraX: 0.4756, endCameraY: -0.8346, endCameraZ: 1.1417, startTargetX: 0, startTargetY: 0, startTargetZ: 0, endTargetX: -0.0355, endTargetY: -0.0708, endTargetZ: -0.0125, startFocalLength: 56.1, endFocalLength: 59.2593, startFocusX: 0, startFocusY: 0, startFocusZ: 0.0012, endFocusX: -0.0255, endFocusY: -0.0857, endFocusZ: 0.01, startFocusDistance: 2, endFocusDistance: 1.4467, startDepthOfField: 1789.0375, endDepthOfField: 48.1417, planeW: 1.4613, planeH: 0.9956, planeX: 0, planeY: 0, planeZ: 0, planeScale: 1, planeRotXDeg: 0, planeRotYDeg: 0, planeRotZDeg: 0, maxBlur: 0.05, shutterAngle: 90, motionBlurSamples: 9},
  {name: "june3d", startFrame: -17.982, endFrame: 45.954, startCameraX: -0.2481, startCameraY: -1.7421, startCameraZ: 0.7873, endCameraX: -0.4669, endCameraY: -2.2451, endCameraZ: 2.4316, startTargetX: 0.2101, startTargetY: -0.0222, startTargetZ: -0.4502, endTargetX: 0.0541, endTargetY: -0.4741, endTargetZ: -0.0195, startFocalLength: 59.2593, endFocalLength: 59.2593, startFocusX: -0.1066, startFocusY: -1.211, startFocusZ: 0.4052, endFocusX: 0.0716, endFocusY: -0.4144, endFocusZ: -0.1022, startFocusDistance: 0.6694, endFocusDistance: 3.172, startDepthOfField: 16.0741, endDepthOfField: 2175.0123, planeW: 3.379, planeH: 2.1946, planeX: 0, planeY: 0, planeZ: 0, planeScale: 1, planeRotXDeg: 0, planeRotYDeg: 0, planeRotZDeg: 0, maxBlur: 0.035, shutterAngle: 90, motionBlurSamples: 9},
  {name: "cam4", startFrame: 0, endFrame: 45.954, startCameraX: -1.3134, startCameraY: -0.7003, startCameraZ: 0.7475, endCameraX: -1.0046, endCameraY: -1.0733, endCameraZ: 0.554, startTargetX: -1.0171, startTargetY: 0.2488, startTargetZ: 0.0822, endTargetX: -0.8648, endTargetY: 0.1284, endTargetZ: -0.0625, startFocalLength: 59.2593, endFocalLength: 59.2593, startFocusX: -0.9845, startFocusY: 0.3531, startFocusZ: 0.0091, endFocusX: -0.8784, endFocusY: 0.0116, endFocusZ: -0.0026, startFocusDistance: 1.3278, endFocusDistance: 1.2259, startDepthOfField: 177.037, endDepthOfField: 156.2469, planeW: 2.8, planeH: 1.8185, planeX: 0, planeY: 0, planeZ: 0, planeScale: 1, planeRotXDeg: 0, planeRotYDeg: 0, planeRotZDeg: 0, maxBlur: 0.035, shutterAngle: 90, motionBlurSamples: 9},
  {name: "cam6", startFrame: -10.989, endFrame: 28.971, startCameraX: -1.9996, startCameraY: -0.8144, startCameraZ: 1.1071, endCameraX: -0.9344, endCameraY: -0.8944, endCameraZ: 0.8869, startTargetX: -0.0812, startTargetY: 0.24, startTargetZ: -0.4591, endTargetX: -0.2684, endTargetY: 0.3254, endTargetZ: -0.4321, startFocalLength: 59.2593, endFocalLength: 59.2593, startFocusX: -0.6179, startFocusY: -0.0549, startFocusZ: -0.0209, endFocusX: -0.4855, endFocusY: -0.0722, endFocusZ: -0.0022, startFocusDistance: 1.9387, endFocusDistance: 1.2915, startDepthOfField: 889.0637, endDepthOfField: 895.5026, planeW: 2.8, planeH: 1.8185, planeX: 0, planeY: 0, planeZ: 0, planeScale: 1, planeRotXDeg: 0, planeRotYDeg: 0, planeRotZDeg: 0, maxBlur: 0.035, shutterAngle: 90, motionBlurSamples: 9},
];

/** Text layers: in-scene captions and the two full-frame cards.
 *  Reveal: per-character rise, Range Selector Offset −89→100 over anim window (frames rel. from). */
export const AE_TEXTS = [
  {name: "caption_show", text: "Your show looks like a", from: 65, durationInFrames: 80, xPx: 961.608, yPx: 519.78, opacity: 1, animStartFrame: 0, animEndFrame: 70.929},
  {name: "caption_monday", text: "Monday morning meeting.", from: 87, durationInFrames: 58, xPx: 959.328, yPx: 598.19, opacity: 1, animStartFrame: 0, animEndFrame: 88.911},
  {name: "caption_bgremoval", text: "live background removal", from: 391, durationInFrames: 56, xPx: 960.933, yPx: 558.048, opacity: 0.9, animStartFrame: 0, animEndFrame: 70.929},
  {name: "caption_dropin", text: "drop in video and audio", from: 479, durationInFrames: 54, xPx: 960.933, yPx: 558.048, opacity: 0.9, animStartFrame: 0, animEndFrame: 47.952},
  {name: "caption_switch", text: "switch cameras", from: 527, durationInFrames: 47, xPx: 960.933, yPx: 549.048, opacity: 0.9, animStartFrame: -14.981, animEndFrame: 60.943},
  {name: "card_allyou", text: "All you need is a camera", from: 574, durationInFrames: 33, xPx: 960.933, yPx: 558.048, opacity: 0.9, animStartFrame: -8.638, animEndFrame: 48.305},
  {name: "card_closing", text: "Your studio. Anywhere.", from: 896, durationInFrames: 75, xPx: 960.933, yPx: 558.048, opacity: 0.9, animStartFrame: -13.955, animEndFrame: 68.962},
];

export const AE_AUDIO = {shineFrom: 145, logoRevealFrom: 834} as const;

/** Render Comp (logo bumper) window; content stays code-built. */
export const AE_BUMPER = {from: 842, durationInFrames: 54} as const;

/** The always-on backdrop: AE Gradient Ramp (radial) on the bottom solid. */
export const AE_BACKDROP = {
  startColor: "#05172d",
  endColor: "#031016",
  startPos: [963.000015258789, 539.999984741211],
  endPos: [1422, 1089.00001525879],
} as const;
