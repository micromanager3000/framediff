#!/usr/bin/env python3
"""Fit corner-pin quads for the 3D-plane shots: optimize 4 output-space corners (+ source time)
so the warped source matches the target frame. Emits normalized corners for GradedVideo."""
import subprocess, sys, json
import numpy as np

T = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
P = "/path/to/framediff/examples/hero-lower-third/public/raw"
FPS = 24000 / 1001
W, H = 192, 108

def grab(path, sel=None, ss=None):
    cmd = ["ffmpeg", "-v", "error"]
    if ss is not None: cmd += ["-ss", str(max(0, ss))]
    cmd += ["-i", path, "-vf", (f"select=eq(n\\,{sel})," if sel is not None else "") + f"scale={W}:{H},format=gray",
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    if len(raw) < W * H: return None
    return np.frombuffer(raw[: W * H], dtype=np.uint8).reshape(H, W).astype(np.float32)

def homography(src_pts, dst_pts):
    A = []
    for (x, y), (u, v) in zip(src_pts, dst_pts):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    A = np.array(A)
    _, _, vt = np.linalg.svd(A)
    return vt[-1].reshape(3, 3)

def warp(src, quad, bg=12.0):
    # quad: 4 output corners (normalized) for source unit square TL,TR,BR,BL
    Hm = homography(quad, [(0, 0), (1, 0), (1, 1), (0, 1)])  # out→src
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ox, oy = xx / W, yy / H
    d = Hm[2, 0] * ox + Hm[2, 1] * oy + Hm[2, 2]
    sx = (Hm[0, 0] * ox + Hm[0, 1] * oy + Hm[0, 2]) / d
    sy = (Hm[1, 0] * ox + Hm[1, 1] * oy + Hm[1, 2]) / d
    inside = (sx >= 0) & (sx < 1) & (sy >= 0) & (sy < 1)
    xi = np.clip((sx * src.shape[1]).astype(int), 0, src.shape[1] - 1)
    yi = np.clip((sy * src.shape[0]).astype(int), 0, src.shape[0] - 1)
    out = np.where(inside, src[yi, xi], bg)
    return out

def ncc(a, b):
    a = a - a.mean(); b = b - b.mean()
    return float((a * b).sum() / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))

def fit(tgt, src, init):
    q = np.array(init, dtype=np.float64)
    best = ncc(warp(src, q), tgt)
    scales = [0.2, 0.08, 0.03, 0.012]
    rng = np.random.default_rng(7)
    for s in scales:
        for _ in range(400):
            cand = q + rng.normal(0, s, q.shape)
            v = ncc(warp(src, cand), tgt)
            if v > best:
                best, q = v, cand
    return best, q

if __name__ == "__main__":
    SHOTS = [
        # name, target frame, proxy, base trim at shot start, rate, time-search window
        ("uizoom", 375, "uizoom.mp4", 0.0, 1.0, np.arange(0.6, 2.0, 0.25)),
        ("june3d", 425, "june3d.mp4", 0.77, 1.0, np.arange(1.2, 2.4, 0.25)),
        ("cam4",   504, "cam6.mp4",  None, 1.0, np.arange(0.0, 6.5, 0.5)),
        ("cam6",   650, "cam6.mp4",  None, 1.0, np.arange(0.0, 6.5, 0.5)),
    ]
    INIT = [(-0.1, -0.1), (1.1, -0.15), (1.15, 1.1), (-0.05, 1.15)]

    out = {}
    for name, tf, proxy, trim, rate, times in SHOTS:
        tgt = grab(T, sel=tf)
        best = (-1, None, None)
        for st in times:
            src = grab(f"{P}/{proxy}", ss=float(st))
            if src is None: continue
            v, q = fit(tgt, src, INIT)
            if v > best[0]:
                best = (v, q, float(st))
        v, q, st = best
        out[name] = {"ncc": round(v, 3), "src_t_at_probe": st,
                     "corners": [[round(float(x), 4), round(float(y), 4)] for x, y in q.reshape(4, 2)]}
        print(f"{name}: ncc={v:.3f} src_t={st:.2f} corners={out[name]['corners']}")
    json.dump(out, open("cornerfit.json", "w"), indent=1)
