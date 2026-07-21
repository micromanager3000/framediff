// The EDL: AEP ground truth (src/data/heroAep.gen.ts, derived from ae/aep-dump.json) mapped onto the
// browser-safe proxies cut from the RAW footage by scripts/make-proxies.sh. The reference render
// is never an input — where numbers below are not AEP-exact they are measured fits against the
// Desktop raw files, which for a few AI-rendered clips are NOT the same renders the AEP used
// (different fps/duration re-exports), so the AEP's source seconds don't apply verbatim.

import {
  AE_AUDIO,
  AE_BUMPER,
  AE_EDL,
  AE_GRID,
  AE_KEYNOTE,
  AE_SPLIT,
  AE_TEXTS,
  type AeEdlRow,
  type AePaneRow,
} from "./heroAep.gen";
import { RAW_ASSETS, RAW_PROXY_ASSETS } from "./rawAssets";

export type ShotFx = "plane3d";

/** 2D placement straight from the AE layer: anchor px in source, pos/scale keys. */
export interface ShotMotion {
  anchor: [number, number];
  srcW: number;
  srcH: number;
  /** key frames relative to the shot window (fractional; may lie outside it) */
  f0: number;
  f1: number;
  pos0: [number, number];
  pos1: [number, number];
  scale0: number;
  scale1: number;
  /** interpolation between the keys (from the AE key types) */
  ease: "linear" | "smooth";
  /** measured position path (frames rel. window) — wins over pos0/pos1 when present; used
   *  where the AE keys' ease data isn't in the dump and the curve was fitted per-frame */
  path?: Array<{ f: number; x: number; y: number }>;
}

export interface HeroShot {
  name: string;
  /** placement in the hero comp, frames @ 23.976 */
  from: number;
  durationInFrames: number;
  /** asset:// proxy ref */
  src: string;
  /** source in-point in PROXY seconds */
  trimStart: number;
  /** source seconds per comp second */
  playbackRate: number;
  fx?: ShotFx;
  motion?: ShotMotion;
}

export interface HeroPane extends HeroShot {
  /** AE Fill effect on the layer — renders as a flat dark backdrop, not video */
  darkFill: boolean;
}

/** shot name → proxy asset + where that proxy starts in the raw source (make-proxies.sh). */
const PROXY: Record<string, { src: string; cut: number }> = {
  open: { src: RAW_PROXY_ASSETS.open, cut: 2.4 },
  phone: { src: RAW_PROXY_ASSETS.phone, cut: 4.2 },
  news_a: { src: RAW_PROXY_ASSETS.news, cut: 4.9 },
  news_b: { src: RAW_PROXY_ASSETS.news, cut: 4.9 },
  news_c: { src: RAW_PROXY_ASSETS.news, cut: 4.9 },
  uizoom: { src: RAW_PROXY_ASSETS.uiZoom, cut: 0 },
  june3d: { src: RAW_PROXY_ASSETS.june3d, cut: 27.4 },
  cam4: { src: RAW_PROXY_ASSETS.cam4, cut: 736.0 },
  hf_talk: { src: RAW_PROXY_ASSETS.hfTalk, cut: 2.2 },
  magnific: { src: RAW_PROXY_ASSETS.magnific, cut: 0.5 },
  cam6: { src: RAW_PROXY_ASSETS.cam6, cut: 187.0 },
  greenwide: { src: RAW_PROXY_ASSETS.greenwide, cut: 0 },
  greentrack: { src: RAW_PROXY_ASSETS.greenwide, cut: 0 },
  desk: { src: RAW_PROXY_ASSETS.desk, cut: 45.2 },
  smartest: { src: RAW_PROXY_ASSETS.smartest, cut: 35.1 },
  blazer: { src: RAW_PROXY_ASSETS.blazer, cut: 0 },
  tripod_a: { src: RAW_PROXY_ASSETS.tripod, cut: 15.6 },
  tripod_b: { src: RAW_PROXY_ASSETS.tripod, cut: 15.6 },
  keynote_b: { src: RAW_PROXY_ASSETS.keynoteB, cut: 11.3 },
  grid: { src: RAW_PROXY_ASSETS.grid, cut: 2.3 },
  split_l: { src: RAW_PROXY_ASSETS.splitLeft, cut: 0 },
  split_r: { src: RAW_PROXY_ASSETS.splitRight, cut: 6.8 },
  keynote_a: { src: RAW_PROXY_ASSETS.keynoteA, cut: 4.2 },
};

/** The latest2* clips on disk are re-renders (other fps/length) of what the AEP cut, so the
 *  AEP's source seconds need an empirical mapping: trims measured by NCC frame-matching against
 *  the Desktop files (scripts/analysis), expressed in RAW seconds of the Desktop copies. */
const DIVERGENT_FITS: Record<string, { rawIn: number; rate: number }> = {
  // Desktop newsroom runs 69.633s vs the AEP copy's 69.365s → ×1.004; aligned at comp f200,
  // then re-measured against the reference (2026-07-07): our content ran ~1.5 frames late,
  // no drift. rawIn calibrated by scanning trim offsets to the zero-crossing (0.747→−1.5
  // frames, 0.831→+1 ⇒ 0.797 → rawIn 5.697).
  news_a: { rawIn: 5.697, rate: 1.004 },
  news_b: { rawIn: 14.16, rate: 1.047 },
  news_c: { rawIn: 15.764, rate: 0.981 },
  smartest: { rawIn: 35.862, rate: 0.905 },
  // keynote_b: Desktop is a retimed wider re-render — time+scale fitted (fitpane.py, NCC 0.90)
  keynote_b: { rawIn: 12.42, rate: 1.0 },
  // the Desktop kling-gerar render cuts wide→closeup at 1.500s where the AEP's copy cuts at
  // 1.667s (4 frames @24 less wide footage) — shift both segments by that measured offset
  greenwide: { rawIn: 1.0833 - 1 / 6, rate: 1.0 },
  greentrack: { rawIn: 1.5, rate: 1.0 },
};

/** Divergent-source placement fits (scripts/analysis/fitpane.py): scale% override. */
const FIT_SCALE: Record<string, number> = {
  // Desktop keynote-01-50 is a wider-framed re-render: ref = proxy ×107.5% centered (NCC 0.90)
  keynote_b: 107.5,
};

/** Measured pane slide paths for the split moment: the AE keys' ease isn't in the dump, so the
 *  positions were fitted per-frame against the reference (fitpane.py at f455/f468/f480). */
const FIT_PATHS: Record<string, Array<{ f: number; x: number; y: number }>> = {
  split_0: [
    { f: 0, x: 960, y: 540 },
    { f: 5, x: 960, y: 540 }, // the reference holds full-frame ~5 frames before the whip
    { f: 8, x: 700, y: 540 },
    { f: 21, x: 500, y: 540 },
    { f: 33.2, x: 490, y: 540 },
  ],
  split_1: [
    { f: 0, x: 2144, y: 540 },
    { f: 5, x: 2144, y: 540 },
    { f: 8, x: 1930, y: 540 },
    { f: 21, x: 1780, y: 540 },
    { f: 33.2, x: 1764, y: 540 },
  ],
};
/** uniform retime ratio for the keynote-12-27 panes (Desktop 13.505s vs AEP 13.455s) */
const KEYNOTE_A_RATIO = 13.505 / 13.455;

const PLANE3D = new Set(["uizoom", "june3d", "cam4", "cam6"]);
const KEYNOTE_VISIBLE_EXTRA_FRAMES: Record<string, number> = {
  keynote_0: 7,
  keynote_1: 5,
  keynote_2: 0,
};

// The AE-rendered hero footage appears one frame after a layer's in-point once it is sampled back
// through the final MP4. The raw rebuild absorbs that visibility rule so Main can match the target
// frame-for-frame instead of needing comparison-only offsets.
export const AE_VISIBLE_FRAME_OFFSET = 1;
export const aeVisibleFrom = (from: number) => (from === 0 ? 0 : from + AE_VISIBLE_FRAME_OFFSET);

function motionOf(row: AeEdlRow, name = row.name): ShotMotion {
  const scale = FIT_SCALE[name];
  return {
    anchor: row.anchor,
    srcW: row.srcW,
    srcH: row.srcH,
    f0: row.f0,
    f1: row.f1,
    pos0: row.pos0,
    pos1: row.pos1,
    scale0: scale ?? row.scale0,
    scale1: scale ?? row.scale1,
    ease: row.ease,
    path: FIT_PATHS[name],
  };
}

function toShot(row: AeEdlRow): HeroShot {
  const proxy = PROXY[row.name];
  if (!proxy) throw new Error(`no proxy mapping for shot ${row.name}`);
  const fit = DIVERGENT_FITS[row.name];
  const rawIn = fit ? fit.rawIn : Math.max(0, row.srcIn);
  return {
    name: row.name,
    from: aeVisibleFrom(row.from),
    durationInFrames: row.durationInFrames,
    src: proxy.src,
    trimStart: Math.max(0, rawIn - proxy.cut),
    playbackRate: fit ? fit.rate : row.rate,
    fx: PLANE3D.has(row.name) ? "plane3d" : undefined,
    motion: motionOf(row),
  };
}

function toPane(row: AePaneRow, proxyKey: string, ratio = 1, visibleExtraFrames = 0): HeroPane {
  const proxy = PROXY[proxyKey];
  return {
    ...toShot({ ...row, name: proxyKey, srcIn: row.srcIn * ratio }),
    name: row.name,
    from: aeVisibleFrom(row.from) + visibleExtraFrames,
    durationInFrames: row.durationInFrames,
    darkFill: row.darkFill,
    motion: motionOf(row, row.name),
    src: proxy.src,
  };
}

// greenwide/greentrack are the two halves of the same kling clip around its internal cut (the
// second half carries an AE 3D-tracker overlay precomp the rebuild does not reproduce).
export const HERO_SHOTS: HeroShot[] = AE_EDL.map(toShot);

{
  const first = HERO_SHOTS[0];
  const second = HERO_SHOTS[1];
  if (first && second) first.durationInFrames = Math.max(first.durationInFrames, second.from - first.from);
}

// The grid moment wipes IN over the phone shot (both grid masks sweep left→right), so the
// phone clip must keep playing beneath it until fully covered — its AE layer really runs to
// 5.083s. The visible-window EDL cut it at the dark layer's in-point; restore the real tail.
{
  const phone = HERO_SHOTS.find((s) => s.name === "phone");
  if (phone) phone.durationInFrames = 122 - phone.from;
}

{
  const cam4 = HERO_SHOTS.find((s) => s.name === "cam4");
  const keynoteStart = Math.min(
    ...AE_KEYNOTE.map((row) => aeVisibleFrom(row.from) + (KEYNOTE_VISIBLE_EXTRA_FRAMES[row.name] ?? 0)),
  );
  if (cam4) cam4.durationInFrames = Math.max(cam4.durationInFrames, keynoteStart - cam4.from);
}

/** The grid moment: stream-feio precomp twice — dark silhouette below, video pane above. */
export const HERO_GRID: HeroPane[] = AE_GRID.map((r) => toPane(r, "grid"));

/** The split moment: hf clip slides left of the split line, 13-35-32 slides on the right. */
export const HERO_SPLIT: HeroPane[] = [toPane(AE_SPLIT[0], "split_l"), toPane(AE_SPLIT[1], "split_r")];

/** The keynote moment: dark backdrop pane + two stacked panes at different source-ins. */
export const HERO_KEYNOTE: HeroPane[] = AE_KEYNOTE.map((r) =>
  toPane(r, "keynote_a", KEYNOTE_A_RATIO, KEYNOTE_VISIBLE_EXTRA_FRAMES[r.name] ?? 0),
);

/** Text overlays (captions + the two full-frame cards), AE positions on the target-visible timeline. */
export const HERO_TEXTS = AE_TEXTS.map((t) => ({ ...t, from: aeVisibleFrom(t.from) }));
const cardAllYouBase = HERO_TEXTS.find((t) => t.name === "card_allyou")!;
const hfTalkStart = HERO_SHOTS.find((s) => s.name === "hf_talk")?.from;
export const CARD_ALLYOU = {
  ...cardAllYouBase,
  durationInFrames: Math.min(cardAllYouBase.durationInFrames, (hfTalkStart ?? Infinity) - cardAllYouBase.from),
};
export const CARD_CLOSING = HERO_TEXTS.find((t) => t.name === "card_closing")!;
export const HERO_CAPTIONS = HERO_TEXTS.filter((t) => t.name.startsWith("caption_"));

export const BUMPER = { from: aeVisibleFrom(AE_BUMPER.from), dur: AE_BUMPER.durationInFrames };
export const HERO_UI_TEXT = [{ name: "bumper", text: "Lighttwist" }] as const;

/** Audio cues (frames): the bed under everything, stings at the reveals.
 *  asset:// refs resolve through framediff.assets.json → the cache folder. */
export const HERO_AUDIO = {
  bed: RAW_ASSETS.audioBed,
  shine: RAW_ASSETS.shine,
  logoReveal: RAW_ASSETS.logoReveal,
  shineFrom: AE_AUDIO.shineFrom,
  logoRevealFrom: AE_AUDIO.logoRevealFrom,
};
