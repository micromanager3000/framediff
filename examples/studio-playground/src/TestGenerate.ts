import { generative } from "framediff";

export const testGenerateComp = generative({
  id: "TestGenerate",
  file: "src/TestGenerate.ts",
  provider: "fal",
  output: "video",
  model: "seedance-2.0",
  prompt: "Describe the shot you want to generate.",
  tier: "fast",
  resolution: "720p",
  duration: 5,
  aspect: "16:9",
  audio: true,
  fps: 30,
  take: 0,
});
