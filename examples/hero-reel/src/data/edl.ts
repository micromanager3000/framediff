// The edit decision list, from docs/HERO-REEL-SPEC.md (the AE "LightTwist" comp). Shots play
// back-to-back (durations ≤ the transcoded proxy lengths so nothing freezes); captions + sections
// are placed at their spec times (24fps). The proxies are already trimmed to each shot's source-in,
// so each plays from trimStart 0.

export interface Shot {
  src: string;
  dur: number;
  from: number;
  /** render this shot through a faux-3D effect (matching the AE 3D-camera interface shots). */
  fx?: "3d" | "cornerpin";
}

const RAW: { src: string; dur: number; fx?: "3d" | "cornerpin" }[] = [
  { src: "asset://reel-s01", dur: 44 }, // NANDO_FX3_0023 — open
  { src: "asset://reel-s02", dur: 47 }, // NANDO_FX3_0030
  { src: "asset://reel-s03", dur: 54 }, // stream feio — "your show looks like a Monday morning meeting"
  { src: "asset://reel-s04a", dur: 84 }, // newsroom — the polished contrast (wide)
  { src: "asset://reel-s04b", dur: 24 }, // newsroom — cut 2
  { src: "asset://reel-s04c", dur: 42 }, // newsroom — cut 3
  { src: "asset://reel-s05", dur: 50, fx: "3d" }, // Screen Recording — on a 3D plane (VideoPlane3D)
  { src: "asset://reel-s06", dur: 48 }, // 2026-06-15 — live background removal
  { src: "asset://reel-s07", dur: 50 }, // 2026-04-24 13-35-32 — drop in video and audio
  { src: "asset://reel-s08", dur: 56, fx: "3d" }, // explicacao interface — 3D camera move (VideoPlane3D)
  { src: "asset://reel-s09", dur: 70 }, // keynote — switch cameras / all you need is a camera
  { src: "asset://reel-s10", dur: 38 }, // magnific
  { src: "asset://reel-s11", dur: 58 }, // kling gerar_uma
  { src: "asset://reel-s12", dur: 66 }, // 2026-04-24 13-52-20
  { src: "asset://reel-s13", dur: 58 }, // 2026-04-24 13-57-01
  { src: "asset://reel-s14", dur: 40 }, // keynote 16-01-50 — last live shot
];

export const SHOTS: Shot[] = (() => {
  let f = 0;
  return RAW.map((s) => {
    const shot = { ...s, from: f };
    f += s.dur;
    return shot;
  });
})();

export const FOOTAGE_END = SHOTS.reduce((a, s) => a + s.dur, 0); // 829

export interface CaptionSpec {
  text: string;
  text2?: string;
  from: number;
  dur: number;
}
export const CAPTIONS: CaptionSpec[] = [
  { text: "Your show looks like a", text2: "Monday morning meeting.", from: 70, dur: 80 },
  { text: "live background removal", from: 350, dur: 45 },
  { text: "drop in video and audio", from: 450, dur: 48 },
  { text: "switch cameras", from: 500, dur: 40 },
  { text: "All you need is a camera", from: 543, dur: 45 },
];

export const LOWER_THIRD = { from: 180, dur: 168 }; // Rendered in realtime… LightTwist
export const BUMPER = { from: FOOTAGE_END, dur: 54 }; // 3D logo → here a branded title card
export const CLOSING = { from: FOOTAGE_END + 54, dur: 72 }; // "Your studio. Anywhere."
export const ENDCARD = { from: FOOTAGE_END + 126, dur: 137 }; // lighttwist.com
export const TOTAL = FOOTAGE_END + 126 + 137; // 1092 (~45.5s)

// audio cues (frames)
export const AUDIO = {
  shineFrom: 145, // ~6s — newsroom reveal
  logoRevealFrom: FOOTAGE_END, // bumper
  endShineFrom: FOOTAGE_END + 126,
};
