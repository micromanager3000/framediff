#!/usr/bin/env python3
"""Fit a pane's 2D placement (scale, center, optional time offset) against a reference frame.

The AEP gives exact layer transforms, but a few Desktop raw files are different re-renders of
what the AEP cut (other framing/timing), so their placement must be measured. This grid-searches
scale/center (and Δt where asked) of a proxy frame to maximize NCC inside a frame region.

Usage: fitpane.py keynote_b | split
"""
import os, sys, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "../..")
RAW = os.path.join(ROOT, "public/raw")
TARGET = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
FPS = 24000 / 1001
REF_OFFSET = 1  # reference frame M shows comp frame M-1
W, H = 960, 540  # half-res workspace


def ref_frame(comp_frame):
    n = comp_frame + REF_OFFSET
    cmd = ["ffmpeg", "-v", "error", "-i", TARGET, "-vf", f"select=eq(n\\,{n}),scale={W}:{H}",
           "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw[: W * H], dtype=np.uint8).reshape(H, W).astype(np.float32)


def proxy_frame(path, t, out_w):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t:.4f}", "-i", path,
           "-vf", f"scale={out_w}:-2", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    h = len(raw) // out_w
    return np.frombuffer(raw[: out_w * h], dtype=np.uint8).reshape(h, out_w).astype(np.float32)


def ncc(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = a.std() * b.std()
    return float((a * b).mean() / d) if d > 1e-6 else -1.0


def place(content, cx, cy, region):
    """Content pasted with its center at (cx,cy) on a WxH canvas; NCC scored inside region."""
    canvas = np.zeros((H, W), np.float32)
    ch, cw = content.shape
    x0, y0 = int(round(cx - cw / 2)), int(round(cy - ch / 2))
    sx0, sy0 = max(0, -x0), max(0, -y0)
    dx0, dy0 = max(0, x0), max(0, y0)
    w = min(cw - sx0, W - dx0); h = min(ch - sy0, H - dy0)
    if w <= 0 or h <= 0: return None
    canvas[dy0:dy0 + h, dx0:dx0 + w] = content[sy0:sy0 + h, sx0:sx0 + w]
    rx0, ry0, rx1, ry1 = region
    return canvas[ry0:ry1, rx0:rx1]


def fit(ref, proxy_path, t_center, region, scales, cxs, cys, dts=(0.0,)):
    rx0, ry0, rx1, ry1 = region
    ref_r = ref[ry0:ry1, rx0:rx1]
    best = (-2, None)
    for dt in dts:
        cache = {}
        for s in scales:
            out_w = max(64, int(round(W * s / 100)))
            key = (dt, out_w)
            if key not in cache:
                cache[key] = proxy_frame(proxy_path, t_center + dt, out_w)
            content = cache[key]
            for cx in cxs:
                for cy in cys:
                    r = place(content, cx, cy, region)
                    if r is None: continue
                    score = ncc(r, ref_r)
                    if score > best[0]:
                        best = (score, dict(dt=round(dt, 3), scale=s, cx=cx * 2, cy=cy * 2))
    return best


if sys.argv[1:] == ["keynote_b"]:
    # comp f825, proxy keynote-b currently placed trim 0.52 rate 1
    ref = ref_frame(825)
    t = 0.52 + (825 - 808) / FPS
    best = fit(ref, os.path.join(RAW, "keynote-b.mp4"), t, (0, 0, W, H),
               scales=np.arange(60, 116, 2.5), cxs=range(340, 621, 10), cys=range(190, 351, 10),
               dts=np.arange(-0.8, 0.81, 0.2))
    print("keynote_b best:", best)
elif sys.argv[1:] == ["split"]:
    ref = ref_frame(468)
    tl = 1.333 + (468 - 447) / FPS
    tr = 0.825 + (468 - 447) / FPS
    bl = fit(ref, os.path.join(RAW, "split-l.mp4"), tl, (0, 0, W // 2, H),
             scales=np.arange(80, 161, 4), cxs=range(60, 421, 10), cys=range(160, 381, 10))
    print("split LEFT best:", bl)
    br = fit(ref, os.path.join(RAW, "split-r.mp4"), tr, (W // 2, 0, W, H),
             scales=np.arange(80, 161, 4), cxs=range(540, 901, 10), cys=range(160, 381, 10))
    print("split RIGHT best:", br)
else:
    print(__doc__)
