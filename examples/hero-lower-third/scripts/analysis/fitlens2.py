#!/usr/bin/env python3
"""Joint offline fit of the uizoom lens curve + shutter angle against the reference.

Base images are analytic warps of the native source frame through the exact camera
(ray-plane, bilinear) — perfectly sharp, no renderer in the loop. For each frame and
region, find the disc-blur radius that matches the reference's laplacian HF; then fit
per-frame lens progress w and a global shutter angle so that
  r_pred = sqrt(r_dof(w)^2 + (streak(shutter)/2)^2)
matches those radii.
"""
import subprocess
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter, map_coordinates

PROXY = "/path/to/framediff/examples/hero-lower-third/public/raw/uizoom.mp4"
SRC_FPS = 60000 / 1001
FPS = 24000 / 1001

CAM0, CAM1 = np.array([0, 0, 2.4691]), np.array([0.4756, -0.8346, 1.1417])
TGT0, TGT1 = np.array([0, 0, 0]), np.array([-0.0355, -0.0708, -0.0125])
F0, F1 = 2.468, 1.4467
K0, K1 = 1789.0375, 48.1417
PLANE_W, PLANE_H = 1.4613, 0.9956
WHIP = [(0,0)] + [(0.0351, 0.0), (0.0702, 0.0), (0.1053, 0.005), (0.1404, 0.015), (0.1754, 0.025), (0.2105, 0.04), (0.2456, 0.06), (0.2807, 0.085), (0.3158, 0.115), (0.3509, 0.15), (0.386, 0.19), (0.4211, 0.24), (0.4561, 0.295), (0.4912, 0.355), (0.5263, 0.43), (0.5614, 0.505), (0.5965, 0.58), (0.6316, 0.66), (0.6667, 0.735), (0.7018, 0.795), (0.7368, 0.85), (0.7719, 0.895), (0.807, 0.93), (0.8421, 0.96), (0.8772, 0.98), (0.9123, 0.99), (0.9474, 1.0), (1.0, 1.0)]
ZOOM = 2666.6667

def curve(pts, u):
    if u <= pts[0][0]:
        return pts[0][1]
    for (u0, v0), (u1, v1) in zip(pts, pts[1:]):
        if u <= u1:
            return v0 + (v1 - v0) * (u - u0) / max(1e-6, u1 - u0)
    return pts[-1][1]

def basis(v):
    eye = CAM0 + (CAM1 - CAM0) * v
    tgt = TGT0 + (TGT1 - TGT0) * v
    fwd = tgt - eye
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    return eye, fwd, right, up

def plane_point(v, cx, cy):
    eye, fwd, right, up = basis(v)
    ndx, ndy = (cx / 1920) * 2 - 1, 1 - (cy / 1080) * 2
    th_v = 540 / ZOOM
    d = fwd + right * (ndx * th_v * 1920 / 1080) + up * (ndy * th_v)
    t = -eye[2] / d[2]
    P = eye + d * t
    return P, float(np.dot(P - eye, fwd))

def project(v, P):
    """world plane point -> comp px under pose v"""
    eye, fwd, right, up = basis(v)
    rel = P - eye
    z = np.dot(rel, fwd)
    x = np.dot(rel, right) / z / (540 / ZOOM * 1920 / 1080)
    y = np.dot(rel, up) / z / (540 / ZOOM)
    return np.array([(x + 1) / 2 * 1920, (1 - y) / 2 * 1080])

REGIONS = {
    "sidebar": ((np.s_[250:800], np.s_[30:200]), (115, 525)),
    "screen": ((np.s_[200:700], np.s_[600:1500]), (1050, 450)),
    "desk": ((np.s_[430:700], np.s_[950:1350]), (1150, 565)),
    "thumbs": ((np.s_[880:1070], np.s_[400:1200]), (800, 975)),
}
FRAMES = [356, 362, 368, 372, 376, 380, 384, 388, 392, 396, 400]

# --- source frames (native proxy) ---
idx = {}
for n in FRAMES:
    t = (n - 348 + 0.5) / FPS
    idx[n] = int(np.floor(t * SRC_FPS + 1e-9))
uniq = sorted(set(idx.values()))
sel = "+".join("eq(n\\,%d)" % k for k in uniq)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", PROXY, "-vf", "select=%s" % sel, "-vsync", "0", "uisrc-%03d.png"], check=True)
srcfile = {k: "uisrc-%03d.png" % (i + 1) for i, k in enumerate(uniq)}

def gray(p):
    return np.asarray(Image.open(p).convert("L"), dtype=np.float64)

def hf(g):
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return lap.std()

def warp_region(v, srcimg, box):
    """sharp analytic render of a comp-space region box under pose v"""
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
    out = map_coordinates(srcimg, [ty, tx], order=1, mode="nearest")
    inside = (np.abs(P[..., 0]) <= PLANE_W / 2) & (np.abs(P[..., 1]) <= PLANE_H / 2) & (t > 0)
    return out, inside.mean()

RADII = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 13, 16, 20, 25, 30]

targets = {}
print("%5s %-8s %6s %6s %7s" % ("frame", "region", "depth", "cover", "r_ref"))
for n in FRAMES:
    u = (n - 348) / 57.0
    v = curve(WHIP, u)
    ref = gray("ref2-%d.png" % n) if n not in (356, 368, 376) else None
    if ref is None:
        continue
    src = gray(srcfile[idx[n]])
    for name, (box, (cx, cy)) in REGIONS.items():
        base, cover = warp_region(v, src, box)
        if cover < 0.98:
            continue
        _, depth = plane_point(v, cx, cy)
        ref_hf = hf(ref[box[0], box[1]])
        cvs = {}
        for r in RADII:
            cvs[r] = hf(base) if r < 0.5 else hf(uniform_filter(base, size=max(2, int(round(r * 2)))))
        r_ref = min(RADII, key=lambda r: abs(cvs[r] - ref_hf))
        targets[(n, name)] = (r_ref, depth)
        print("%5d %-8s %6.3f %6.2f %7.2f" % (n, name, depth, cover, r_ref))

def coc(w, depth):
    f = F0 + (F1 - F0) * w
    K = K0 + (K1 - K0) * w
    return float(np.clip(0.5 * K * abs(1 / max(f, 0.05) - 1 / max(depth, 0.05)) - 1.5, 0, 54))

def streak(n, cx, cy, shutter_frames):
    u = (n - 348) / 57.0
    du = 0.5 / 57.0
    v0, v1 = curve(WHIP, u - du), curve(WHIP, u + du)
    P, _ = plane_point(curve(WHIP, u), cx, cy)
    s0, s1 = project(v0, P), project(v1, P)
    vel = np.linalg.norm(s1 - s0)  # px per comp frame
    return vel * shutter_frames

print()
best = None
for shutter_deg in [0, 90, 180, 270, 360]:
    total = 0.0
    ws = {}
    for n in sorted(set(k[0] for k in targets)):
        cand = np.linspace(0, 1, 201)
        errs = []
        for w in cand:
            e = 0.0
            for name, (box, (cx, cy)) in REGIONS.items():
                if (n, name) not in targets:
                    continue
                r_ref, depth = targets[(n, name)]
                st = streak(n, cx, cy, shutter_deg / 360)
                r_pred = np.hypot(coc(w, depth), st / 2)
                e += (r_pred - r_ref) ** 2
            errs.append(e)
        i = int(np.argmin(errs))
        ws[n] = cand[i]
        total += errs[i]
    print("shutter %3d deg: total err %8.2f | w:" % (shutter_deg, total),
          " ".join("%d:%.2f" % (n, ws[n]) for n in sorted(ws)))
    if best is None or total < best[0]:
        best = (total, shutter_deg, ws)

print()
print("BEST: shutter %d, lens points:" % best[1],
      [(round((n - 348) / 57.0, 3), round(best[2][n], 3)) for n in sorted(best[2])])
