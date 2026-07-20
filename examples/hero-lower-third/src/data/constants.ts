// Values ported 1:1 from lt-marketing (the Remotion project that produced the reference video).

export const FPS = 24000 / 1001; // 23.976 — matches the source mp4 exactly

export const VIDEO_FRAMES = 971; // hero.mp4 — 40.5s of footage
export const END_FRAMES = Math.round(5 * FPS); // 5s outro ≈ 120 frames
export const CROSSFADE = 18; // end card enters over the last ~0.75s of footage

export const TL = {
  durationInFrames: VIDEO_FRAMES + END_FRAMES, // 1091 ≈ 45.5s
  lowerThird: { from: 180, dur: 168 }, // ~7.5s → ~14.5s
  endCard: { from: VIDEO_FRAMES - CROSSFADE, dur: END_FRAMES + CROSSFADE }, // 953 → 1091
  audioFadeStart: VIDEO_FRAMES - 24, // hero audio fades out over the last second of footage
} as const;

// lt-marketing/src/constants.ts — COLORS + FONTS, verbatim (subset used by this piece).
export const COLORS = {
  bg: "#0a0a0f",
  accent: "#6c5ce7",
  accentLight: "#a29bfe",
  accentWarm: "#fd79a8",
  white: "#ffffff",
} as const;

export const FONTS = {
  heading: "SF Pro Display, -apple-system, Helvetica Neue, sans-serif",
} as const;
