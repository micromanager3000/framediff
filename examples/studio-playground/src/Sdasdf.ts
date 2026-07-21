import { generative } from "framediff";

export const sdasdfComp = generative({
  id: "Sdasdf",
  file: "src/Sdasdf.ts",
  provider: "fal",
  model: "veo-3.1-fast",
  prompt: "Describe the shot you want to generate.",
  resolution: "720p",
  duration: 8,
  aspect: "16:9",
  audio: true,
  seed: 0,
  fps: 30,
  take: 0,
});
