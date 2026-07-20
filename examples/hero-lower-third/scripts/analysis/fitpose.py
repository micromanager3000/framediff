#!/usr/bin/env python3
"""Dense position-progress fit for uizoom: for each comp frame, find the camera progress v
whose analytic warp of the source best NCC-matches the reference frame. Fully offline."""
import subprocess
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, gaussian_filter

PROXY = "/path/to/framediff/examples/hero-lower-third/public/raw/uizoom.mp4"
REF = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
SRC_FPS = 60000 / 1001
FPS = 24000 / 1001
CAM0, CAM1 = np.array([0, 0, 2.4691]), np.array([0.4756, -0.8346, 1.1417])
TGT0, TGT1 = np.array([0, 0, 0]), np.array([-0.0355, -0.0708, -0.0125])
PLANE_W, PLANE_H = 1.4613, 0.9956
ZOOM = 2666.6667
FRAMES = list(range(350, 405, 2))

def basis(v):
    eye = CAM0 + (CAM1 - CAM0) * v
    tgt = TGT0 + (TGT1 - TGT0) * v
    fwd = tgt - eye
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    return eye, fwd, right, up

def warp(v, srcimg, box):
    ys, xs = box
    yy, xx = np.mgrid[ys, xs].astype(np.float64)
    eye, fwd, right, up = basis(v)
    th_v = 540 / ZOOM
    ndx, ndy = (xx / 1920) * 2 - 1, 1 - (yy / 1080) * 2
    dirs = (fwd[None, None, :] + right[None, None, :] * (ndx * th_v * 1920 / 1080)[..., None]
            + up[None, None, :] * (ndy * th_v)[..., None])
    t = -eye[2] / dirs[..., 2]
    P = eye[None, None, :] + dirs * t[..., None]
    sh, sw = srcimg.shape
    tx = (P[..., 0] / PLANE_W + 0.5) * sw
    ty = (0.5 - P[..., 1] / PLANE_H) * sh
    return map_coordinates(srcimg, [ty, tx], order=1, mode="nearest")

def gray(p):
    return np.asarray(Image.open(p).convert("L"), dtype=np.float64)

def ncc(a, b):
    # blur both a touch so REF's motion/DoF blur doesn't dominate alignment
    a = gaussian_filter(a, 2.0)
    b = gaussian_filter(b, 2.0)
    aa, bb = a - a.mean(), b - b.mean()
    d = np.sqrt((aa * aa).sum() * (bb * bb).sum())
    return (aa * bb).sum() / d if d > 0 else 0.0

# extract needed frames
idx = {n: int(np.floor((n - 348 + 0.5) / FPS * SRC_FPS + 1e-9)) for n in FRAMES}
uniq = sorted(set(idx.values()))
sel = "+".join("eq(n\\,%d)" % k for k in uniq)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", PROXY, "-vf", "select=%s" % sel, "-vsync", "0", "psrc-%03d.png"], check=True)
srcfile = {k: "psrc-%03d.png" % (i + 1) for i, k in enumerate(uniq)}
missing = [n for n in FRAMES if not __import__("os").path.exists("pref-%d.png" % n)]
for n in missing:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", REF, "-vf", "select=eq(n\\,%d)" % (n + 1), "-vframes", "1", "pref-%d.png" % n], check=True)

BOX = (np.s_[150:930], np.s_[200:1700])  # generous central region, mostly on-plane

print("frame     u    best_v   ncc")
pts = []
prev_v = 0.0
for n in FRAMES:
    u = (n - 348) / 57.0
    src = gray(srcfile[idx[n]])
    ref = gray("pref-%d.png" % n)[BOX[0], BOX[1]]
    lo, hi = max(0, prev_v - 0.08), min(1, prev_v + 0.25)
    best_v, best_s = prev_v, -1
    for v in np.arange(lo, hi + 1e-9, 0.02):
        s = ncc(warp(v, src, BOX), ref)
        if s > best_s:
            best_v, best_s = v, s
    for v in np.arange(max(0, best_v - 0.02), min(1, best_v + 0.02) + 1e-9, 0.005):
        s = ncc(warp(v, src, BOX), ref)
        if s > best_s:
            best_v, best_s = v, s
    prev_v = best_v
    pts.append((round(u, 4), round(best_v, 4), round(best_s, 3)))
    print("%5d %6.3f %8.3f %6.3f" % (n, u, best_v, best_s))

print()
print("dense FIT_PROGRESS:", [(p[0], p[1]) for p in pts])
