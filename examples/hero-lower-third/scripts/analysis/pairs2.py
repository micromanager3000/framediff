#!/usr/bin/env python3
"""Regenerate pairs.npz for gradefit.py from the CURRENT AEP-exact mapping.

The original pairs came from the NCC-recovered EDL (boundaries.py) — several source moments
have since been corrected from the AEP dump (cam4/cam6 re-cuts, exact src-ins, boundary rule)
and the comparisons established that reference frame M shows comp frame M−1. Sources here are
the browser proxies (colorimetrically identical re-encodes of the raw footage — and exactly
what the LUTs get applied to at render time). The reference stays output-test-only: it is the
TARGET of the fit, never an input to the composition.

Run:  python3 pairs2.py   (writes pairs.npz next to this script)
Then: python3 gradefit.py
"""
import os, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "../../public/raw")
TARGET = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
FPS = 24000 / 1001
REF_OFFSET = 1  # reference frame M shows comp frame M−1

# Mirrors src/data/heroEdl.ts (AEP rows + divergent-source fits + proxy cuts). trim = proxy seconds.
# (name, proxy file, comp_from, comp_dur, trimStart, rate)
SHOTS = [
    ("open",       "open.mp4",       0,   44, 1.0006, 0.9),
    ("phone",      "phone.mp4",     44,   47, 0.7484, 1.0),
    ("grid",       "grid.mp4",      91,   54, 0.6580, 1.0),
    ("news_a",     "news.mp4",     145,  118, 0.7970, 1.004),
    ("news_b",     "news.mp4",     263,   34, 9.2600, 1.047),
    ("news_c",     "news.mp4",     297,   51, 10.864, 0.981),
    ("uizoom",     "uizoom.mp4",   348,    5, 0.0,    1.0),   # rest frames only: plane fills 1:1
    ("keynote_a",  "keynote-a.mp4",521,   29, 0.8930, 1.0),   # the full-frame middle pane (L24)
    ("hf_talk",    "hf-talk.mp4",  606,   17, 0.6338, 1.0),
    ("magnific",   "magnific.mp4", 623,   16, 0.7085, 1.0),
    ("greenwide",  "greenwide.mp4",661,   14, 0.9166, 1.0),
    ("greentrack", "greenwide.mp4",675,   18, 1.5,    1.0),
    ("desk",       "desk.mp4",     693,   26, 0.6869, 1.0),
    ("smartest",   "smartest.mp4", 719,   24, 0.7620, 0.905),
    ("blazer",     "blazer.mp4",   743,   20, 0.0,    1.0),
    ("tripod",     "tripod.mp4",   763,   19, 0.3039, 1.0),   # tripod_a; _b is the same look
    ("keynote_b",  "keynote-b.mp4",808,   34, 1.1200, 1.0),
]
FRACS = (0.03, 0.2, 0.4, 0.6, 0.8, 0.97)  # heads/tails included: the opener's bright lamp-lit
# wall only exists in the first frames — sampling 0.2..0.8 left those color bins unfitted
# the FX3 shots carry the reference's most scrutinized content (face, lamp glow) — denser
# sampling feeds the brightest/sparsest lattice bins
FX3_FRACS = (0.03, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.97)


def grab(path, t):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{max(0, t):.4f}", "-i", path,
           "-vf", "scale=480:270", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    if len(raw) < 480 * 270 * 3:
        return None
    return np.frombuffer(raw[: 480 * 270 * 3], np.uint8).reshape(270, 480, 3)


# Each pair carries several source-time candidates around the nominal instant. AE's source
# frame choice can differ from ours by a frame or two, and on MOVING content (the opener's
# leaning head) that pairs source skin with differently-shaded reference skin — flat regions
# pass the fitter's mask even misaligned, so the pollution silently flattens/brightens the
# face's fitted tones. gradefit aligns every candidate and keeps the best-NCC one.
CANDIDATE_OFFSETS = (-0.033, -0.017, 0.0, 0.017, 0.033)  # seconds, ~±2 frames at 60 fps

# Shots whose comp view pans far off the source center exceed the fitter's translation
# search — pre-warp those source grabs through the KNOWN AE transform (heroAep.gen motion)
# so alignment only refines around identity. (phone: scale 77->87% with a large pan.)
# shot -> (anchor, (srcW,srcH), f0, f1, pos0, pos1, scale0, scale1); frames rel. shot window.
PREWARP = {
    "phone": ((1920, 1088), (3840, 2160), -1.043, 87.868, (450, 459), (264, 399), 77.0, 87.0),
}

def prewarp_crop(img, name, cf_rel):
    """Crop the comp-visible source region (in grab space) and rescale to grab size."""
    from PIL import Image as PImage
    (ax, ay), (sw, sh), f0, f1, p0, p1, s0, s1 = PREWARP[name]
    u = min(1.0, max(0.0, (cf_rel - f0) / max(1e-6, f1 - f0)))
    sc = (s0 + (s1 - s0) * u) / 100.0
    px, py = p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u
    gx, gy = img.shape[1] / sw, img.shape[0] / sh   # grab px per source px
    x0 = ((0 - px) / sc + ax) * gx
    y0 = ((0 - py) / sc + ay) * gy
    x1 = ((1920 - px) / sc + ax) * gx
    y1 = ((1080 - py) / sc + ay) * gy
    im = PImage.fromarray(img).crop((x0, y0, x1, y1)).resize((img.shape[1], img.shape[0]), PImage.BILINEAR)
    return np.asarray(im)

pairs_t, pairs_s, seg_ids = [], [], []
for name, proxy, f0, dur, trim, rate in SHOTS:
    p = os.path.join(RAW, proxy)
    for frac in (FX3_FRACS if name in ("open", "phone") else FRACS):
        cf = f0 + frac * dur
        st = trim + (cf - f0) / FPS * rate
        t_img = grab(TARGET, (cf + REF_OFFSET) / FPS + 0.02)
        cands = [grab(p, st + 0.02 + off) for off in CANDIDATE_OFFSETS]
        if name in PREWARP:
            cands = [None if c is None else prewarp_crop(c, name, cf - f0) for c in cands]
        if t_img is not None and all(c is not None for c in cands):
            pairs_t.append(t_img)
            pairs_s.append(np.stack(cands))
            seg_ids.append(name)
np.savez_compressed(os.path.join(HERE, "pairs.npz"),
                    target=np.array(pairs_t), source=np.array(pairs_s), seg=np.array(seg_ids))
print(f"pairs: {len(pairs_t)} from {len(set(seg_ids))} segments "
      f"({len(CANDIDATE_OFFSETS)} source candidates each)")
