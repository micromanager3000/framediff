// Reference-to-video: conditions on real project footage (the blazer proxy) — the ref
// is an asset:// id from framediff.assets.json; the dev bridge resolves it to bytes from
// the configured local cache and uploads it to the provider at submit time. Video refs price at 0.6×.

import { generative } from "framediff";

export const blazerRelight = generative({
  id: "blazerRelight",
  file: "src/gen/blazerRelight.gen.ts",
  provider: "fal",
  model: "seedance-2.0",
  tier: "fast",
  prompt: "The presenter turns to camera as warm studio key light blooms on; slow push-in, broadcast look. Match the framing and handheld motion of the reference clip.",
  refs: [{ kind: "video", src: "asset://proxy-blazer" }],
  duration: 4,
  resolution: "720p",
  aspect: "16:9",
  audio: false,
  take: 0,
});
