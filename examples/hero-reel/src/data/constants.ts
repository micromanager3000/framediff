// Brand values reverse-engineered from the LightTwist reel.
export const COLORS = {
  white: "#ffffff",
  accent: "#6c5ce7", // violet
  accentLight: "#a29bfe", // violet light
  accentWarm: "#fd79a8", // pink
  endBg: "#05060a", // end-card base
};

export const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';

// Timeline (frames @ 24fps). Proportions follow the 45.5s original, tightened a little.
export const TL = {
  clipFrames: 144, // 6s per hero clip
  lowerThird: { from: 180, dur: 168 }, // ~7.5s–14.5s
  endCard: { from: 696, dur: 144 }, // last ~6s, fades in over the final hero clip
};
