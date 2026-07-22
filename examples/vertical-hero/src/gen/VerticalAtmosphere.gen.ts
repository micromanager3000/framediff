import { generative } from "framediff";

export const verticalAtmosphere = generative({
  id: "VerticalAtmosphere",
  file: "src/gen/VerticalAtmosphere.gen.ts",
  provider: "fal",
  model: "seedance-2.0",
  prompt: "Use the supplied vertical motion-design comp only as timing, framing, and color-blocking reference. Re-render it as a cinematic nocturnal city portrait with soft violet and rose practical light, subtle atmospheric haze, slow handheld drift, premium editorial texture, and clean negative space for a lower third.",
  refs: [
    { kind: "video", src: "comp://vertical-backdrop" },
    { kind: "video", src: "comp://vertical-lower-third" },
  ],
  tier: "fast",
  resolution: "720p",
  duration: 6,
  aspect: "9:16",
  audio: false,
  fps: 30,
  take: 0,
});
