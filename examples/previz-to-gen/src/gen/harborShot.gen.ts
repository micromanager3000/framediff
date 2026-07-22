// The generative reshoot: this file IS the recipe. It conditions Seedance 2.0 on the previz
// comp itself — `comp://harbor-previz` bakes on submit (a current bake is reused, a stale one
// re-exports first), so editing the scene and hitting Generate is the whole loop. The prompt
// casts the reference as a layout-only blockout: r2v transfers appearance as eagerly as it
// transfers motion, so the words must revoke the previz's CG look — name the ref as previz,
// demand live-action surfaces, and describe the beam as light (not the cone geometry).
//
// `take:` pins which generated output ships (the lockfile — takes live in framediff.assets.json
// with full provenance). Nothing regenerates implicitly: the Studio's Generate button is the
// only paid action, and it needs a fal key (⚿ SERVICES in the topbar, or FAL_KEY).

import { generative } from "framediff";

export const harborShot = generative({
  id: "harborShot",
  file: "src/gen/harborShot.gen.ts",
  provider: "fal",
  model: "seedance-2.0",
  prompt: "@Video1 is an 8-second rough 3D previz. Use it only for spatial blocking, subject motion, camera motion, framing, and editorial timing. Re-render every frame as documentary-grade live-action coastal cinematography; do not inherit the reference's low-poly geometry, flat shading, simplified materials, or CG color palette. EDIT STRUCTURE IS HIGHEST PRIORITY: preserve all three shots and make instantaneous hard cuts at exactly 00:03.00 and 00:05.67. No dissolve, morph, whip-pan, match transition, or continuous camera path across either cut. 00:00.00–00:03.00 — a slow 32mm push across open water toward a working lighthouse on a black granite point. 00:03.00–00:05.67 — hard cut to a low water-level chase behind the same steel-hulled fishing boat as it rounds the point, throwing spray and a churned wake. 00:05.67–00:08.00 — hard cut to the lantern-room gallery, looking down as that same boat crosses the lighthouse beam. WORLD AND CONTINUITY: peeling white paint and rust on the stone tower, wet weathered granite, surging white surf, dark moonlit swell, cold sea mist, and one soft volumetric lamp shaft with feathered edges—light in haze, never solid cone geometry. Photoreal optical detail, natural exposure, subtle lens spray, restrained handheld micro-movement, fine 35mm grain, deep blue hour with a thin ember of sunset. No animation, illustration, miniature, toy, game-engine render, or visible 3D geometry.",
  refs: [
    { kind: "video", src: "comp://harbor-previz" },
    { kind: "image", src: "asset://02b421d1-16a5-443e-acc0-2095e120f73b" },
  ],
  tier: "standard",
  resolution: "720p",
  duration: 8,
  aspect: "16:9",
  audio: false,
  fps: 30,
  take: 5,
});
