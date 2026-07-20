#!/usr/bin/env python3
"""Fit source->target color-grade 3D LUTs (.cube) from pairs.npz.

Pipeline:
  1. Per-pair geometric alignment (global scale+translation via coarse-to-fine
     grayscale NCC search), since reference frames are scaled/cropped.
  2. Local 9x9 NCC masking to drop mismatched/overlay-text pixels.
  3. Robust affine pre-fit + outlier trimming of (src,tgt) color samples.
  4. 17^3 lattice fit (per-bin median target) + screened-diffusion fill/smooth,
     upsampled to 33^3, written as Adobe .cube (R fastest).
  5. Validation: masked PSNR per segment (identity / global / per-seg),
     preview strips [source | graded | target].

Groups: 'open' (+'phone', no pairs) are S-Log-ish FX3 -> fx3.cube.
Everything else fits 'global.cube'; per-seg cube emitted when it beats
global by >2 dB on that segment.
"""
import json
import os
from collections import defaultdict

import numpy as np
from PIL import Image

EDL = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = "/path/to/framediff/examples/hero-lower-third/public/luts"
PREV_DIR = os.path.join(EDL, "gradefit-preview")

FX3_SEGS = {"open", "phone"}       # phone has no pairs; same camera/LUT as open
LUT_N_FIT = 17
LUT_N_OUT = 33
MIN_BIN_COUNT = 20
PAIR_NCC_MIN = 0.40                # below this, pair is considered unalignable
LOCAL_NCC_MIN = 0.60
PER_SEG_GAIN_DB = 2.0
FX3_SMOOTH_BLEND = 0.65             # reduce dark-region artifacts from the sparse FX3 fit
# Output-side per-channel gains, measured per FX3 shot against the reference through the
# full-resolution render-order simulation (per-pixel cube at 4K -> AE transform -> compare
# at NCC-matched frames; stable to ~0.3% across each shot). The 480-space pair fit lands
# ~3% low on green/blue at full res — fold the measured correction into the exported cube,
# where it applies on the correct (post-LUT) side. Re-derive with the same sim if refitting.
FX3_OUTPUT_GAIN = {
    "open": (1.000, 1.033, 1.041),
    "phone": (1.000, 1.030, 1.025),
}
FX3_BLACK_RAMP_IN = 0.015
FX3_BLACK_RAMP_OUT = 0.12
RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- helpers
def to_gray(img):
    return img[..., 0] * 0.299 + img[..., 1] * 0.587 + img[..., 2] * 0.114


def warp_scale_trans(img, s, ty, tx, fill=np.nan):
    """Bilinear resample: out(p) = img((p-c)/s + c + t). img float, 2D or 3D."""
    H, W = img.shape[:2]
    cy, cx = (H - 1) / 2.0, (W - 1) / 2.0
    yy, xx = np.meshgrid(np.arange(H), np.arange(W), indexing="ij")
    sy = (yy - cy) / s + cy + ty
    sx = (xx - cx) / s + cx + tx
    valid = (sy >= 0) & (sy <= H - 1) & (sx >= 0) & (sx <= W - 1)
    sy = np.clip(sy, 0, H - 1)
    sx = np.clip(sx, 0, W - 1)
    y0 = np.floor(sy).astype(np.int32)
    x0 = np.floor(sx).astype(np.int32)
    y1 = np.minimum(y0 + 1, H - 1)
    x1 = np.minimum(x0 + 1, W - 1)
    fy = (sy - y0)[..., None] if img.ndim == 3 else (sy - y0)
    fx = (sx - x0)[..., None] if img.ndim == 3 else (sx - x0)
    out = (img[y0, x0] * (1 - fy) * (1 - fx) + img[y0, x1] * (1 - fy) * fx
           + img[y1, x0] * fy * (1 - fx) + img[y1, x1] * fy * fx)
    if img.ndim == 3:
        out[~valid] = fill
    else:
        out = np.where(valid, out, fill)
    return out, valid


def downscale(g, f):
    """Block-mean downscale of 2D array by integer factor f (crops remainder)."""
    H, W = g.shape
    H2, W2 = (H // f) * f, (W // f) * f
    return g[:H2, :W2].reshape(H2 // f, f, W2 // f, f).mean(axis=(1, 3))


def ncc_search(src_g, tgt_g, scales, trans_range, margin):
    """Brute-force NCC over (scale, integer translation) at one pyramid level.
    Returns (best_ncc, s, ty, tx) with translation in this level's pixels."""
    H, W = tgt_g.shape
    tc = tgt_g[margin:H - margin, margin:W - margin]
    tc0 = tc - tc.mean()
    tn = np.sqrt((tc0 ** 2).sum()) + 1e-9
    th, tw = tc.shape
    best = (-2.0, 1.0, 0, 0)
    r = trans_range
    for s in scales:
        w, valid = warp_scale_trans(src_g, s, 0.0, 0.0, fill=np.nan)
        mu = np.nanmean(w)
        w = np.where(np.isnan(w), mu, w)
        # sliding windows over all translations in [-r, r]
        if margin - r < 0:
            raise ValueError("margin must be >= trans_range")
        sub = w[margin - r:H - margin + r, margin - r:W - margin + r]
        win = np.lib.stride_tricks.sliding_window_view(sub, (th, tw))
        wm = win.mean(axis=(2, 3), keepdims=True)
        w0 = win - wm
        num = (w0 * tc0).sum(axis=(2, 3))
        den = np.sqrt((w0 ** 2).sum(axis=(2, 3))) * tn + 1e-9
        ncc = num / den
        k = np.unravel_index(np.argmax(ncc), ncc.shape)
        if ncc[k] > best[0]:
            best = (float(ncc[k]), float(s), int(k[0] - r), int(k[1] - r))
    return best


def align_pair(src, tgt):
    """Estimate scale+translation mapping so warp(src) matches tgt.
    Returns (aligned_src_float01 HxWx3, valid mask, best_ncc, (s, ty, tx))."""
    sg = to_gray(src.astype(np.float64) / 255.0)
    tg = to_gray(tgt.astype(np.float64) / 255.0)
    # level 4 coarse: +-10 px here = +-40 full-res
    sg4, tg4 = downscale(sg, 4), downscale(tg, 4)
    n4, s4, ty4, tx4 = ncc_search(sg4, tg4, np.arange(0.80, 1.6001, 0.04),
                                  trans_range=10, margin=12)
    # level 2 refine
    sg2, tg2 = downscale(sg, 2), downscale(tg, 2)
    scales2 = np.arange(max(0.78, s4 - 0.05), min(1.62, s4 + 0.0501), 0.01)
    # recentre translation search around coarse estimate by pre-shifting
    w2c, _ = warp_scale_trans(sg2, 1.0, ty4 * 2.0, tx4 * 2.0, fill=np.nan)
    mu = np.nanmean(w2c)
    w2c = np.where(np.isnan(w2c), mu, w2c)
    n2, s2, dy2, dx2 = ncc_search(w2c, tg2, scales2, trans_range=6, margin=16)
    ty2, tx2 = ty4 * 2.0 + dy2, tx4 * 2.0 + dx2
    # full-res: warp once, integer shift refine +-2
    base, valid = warp_scale_trans(sg, s2, ty2 * 2.0, tx2 * 2.0, fill=np.nan)
    best = (-2.0, 0, 0)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            sh = np.roll(np.roll(base, -dy, 0), -dx, 1)
            m = np.isfinite(sh)
            m[:3, :] = m[-3:, :] = False
            m[:, :3] = m[:, -3:] = False
            a, b = sh[m], tg[m]
            a0, b0 = a - a.mean(), b - b.mean()
            n = float((a0 * b0).sum() /
                      (np.sqrt((a0 ** 2).sum() * (b0 ** 2).sum()) + 1e-9))
            if n > best[0]:
                best = (n, dy, dx)
    nf, dyf, dxf = best
    ty, tx = ty2 * 2.0 + dyf, tx2 * 2.0 + dxf
    aligned, valid = warp_scale_trans(src.astype(np.float64) / 255.0,
                                      s2, ty, tx, fill=np.nan)
    return aligned, valid, nf, (s2, ty, tx)


def boxsum(a, rad):
    """Sum over (2r+1)^2 window, same size, edge-padded."""
    w = 2 * rad + 1
    p = np.pad(a, rad, mode="edge")
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[w:, w:] - c[:-w, w:] - c[w:, :-w] + c[:-w, :-w])


def local_ncc_mask(aligned, valid, tgt01):
    """9x9 local NCC between aligned-src gray and target gray.
    Keep structured matches (ncc >= .6) and mutually-flat regions.

    Stats are computed on box-blurred grays: both sides carry film grain (the proxies
    preserve it since 2026-07-07), and grain is uncorrelated between source and reference —
    unblurred it pushes flat walls over the σ threshold AND under the NCC threshold, which
    silently dropped exactly the smooth regions where grade bias is most visible."""
    ag = to_gray(np.where(np.isnan(aligned), 0.0, aligned))
    tg = to_gray(tgt01)
    br = 2
    ag = boxsum(ag, br) / boxsum(np.ones_like(ag), br)
    tg = boxsum(tg, br) / boxsum(np.ones_like(tg), br)
    rad, n = 4, 81.0
    va = valid.astype(np.float64)
    cnt = boxsum(va, rad)
    ok = cnt > n * 0.98                       # window fully valid
    sa, st = boxsum(ag * va, rad), boxsum(tg * va, rad)
    saa, stt = boxsum(ag * ag * va, rad), boxsum(tg * tg * va, rad)
    sat = boxsum(ag * tg * va, rad)
    c = np.maximum(cnt, 1)
    ma, mt = sa / c, st / c
    va_ = np.maximum(saa / c - ma ** 2, 0)
    vt_ = np.maximum(stt / c - mt ** 2, 0)
    cov = sat / c - ma * mt
    stda, stdt = np.sqrt(va_), np.sqrt(vt_)
    ncc = cov / (stda * stdt + 1e-6)
    structured = (ncc >= LOCAL_NCC_MIN) & (stda > 0.01) & (stdt > 0.01)
    both_flat = (stda < 0.008) & (stdt < 0.008)
    return ok & (structured | both_flat)


# ---------------------------------------------------------------- fitting
def fit_affine(src, tgt):
    A = np.hstack([src, np.ones((len(src), 1))])
    M, *_ = np.linalg.lstsq(A, tgt, rcond=None)
    return M  # (4,3)


def apply_affine(M, rgb):
    return rgb @ M[:3] + M[3]


def trim_outliers(src, tgt, iters=2):
    keep = np.ones(len(src), bool)
    for _ in range(iters):
        M = fit_affine(src[keep], tgt[keep])
        r = np.abs(tgt - apply_affine(M, src)).max(axis=1)
        thr = np.clip(4.0 * np.median(r[keep]), 0.06, 0.20)
        keep = r < thr
    return keep, M


def fit_lut(src, tgt, n_fit=LUT_N_FIT, n_out=LUT_N_OUT, lam=1.0):
    """Median-bin lattice + screened diffusion fill, upsample to n_out."""
    keep, M = trim_outliers(src, tgt)
    src, tgt = src[keep], tgt[keep]
    n = n_fit
    idx = np.clip(np.round(src * (n - 1)).astype(np.int64), 0, n - 1)
    flat = (idx[:, 0] * n + idx[:, 1]) * n + idx[:, 2]
    order = np.argsort(flat, kind="stable")
    flat_s, tgt_s = flat[order], tgt[order]
    uniq, start, count = np.unique(flat_s, return_index=True, return_counts=True)
    med = np.empty((len(uniq), 3))
    for j, (st, ct) in enumerate(zip(start, count)):
        med[j] = np.median(tgt_s[st:st + ct], axis=0)
    counts = np.zeros(n ** 3)
    counts[uniq] = count
    data = np.zeros((n ** 3, 3))
    data[uniq] = med
    filled = counts >= MIN_BIN_COUNT
    conf = (np.minimum(counts, 500.0) / 500.0 * 20.0) * filled

    ax = np.linspace(0, 1, n)
    R, G, B = np.meshgrid(ax, ax, ax, indexing="ij")
    centers = np.stack([R, G, B], -1).reshape(-1, 3)
    aff = np.clip(apply_affine(M, centers), 0, 1)    # affine extrapolation
    grid = aff.copy()
    grid[filled] = data[filled]
    grid = grid.reshape(n, n, n, 3)
    conf3 = conf.reshape(n, n, n, 1)
    dat3 = data.reshape(n, n, n, 3)
    aff3 = aff.reshape(n, n, n, 3)
    eps = 0.05             # weak pull of empty bins toward affine trend
    for _ in range(400):
        nb = np.zeros_like(grid)
        cnt = np.zeros((n, n, n, 1))
        for axis in range(3):
            a = [slice(None)] * 3
            b = [slice(None)] * 3
            a[axis] = slice(0, n - 1)
            b[axis] = slice(1, n)
            nb[tuple(a)] += grid[tuple(b)]
            nb[tuple(b)] += grid[tuple(a)]
            cnt[tuple(a)] += 1
            cnt[tuple(b)] += 1
        grid = (conf3 * dat3 + eps * aff3 + lam * nb) / (conf3 + eps + lam * cnt)
    grid = np.clip(grid, 0, 1)
    # upsample n_fit(17) -> n_out(33): exact 2x linear refinement
    assert n_out == 2 * n_fit - 1
    g = grid
    for axis in range(3):
        sh = list(g.shape)
        sh[axis] = sh[axis] * 2 - 1
        out = np.zeros(sh)
        a = [slice(None)] * 4
        a[axis] = slice(0, sh[axis], 2)
        out[tuple(a)] = g
        b = [slice(None)] * 4
        b[axis] = slice(1, sh[axis] - 1, 2)
        lo = [slice(None)] * 4
        lo[axis] = slice(0, g.shape[axis] - 1)
        hi = [slice(None)] * 4
        hi[axis] = slice(1, g.shape[axis])
        out[tuple(b)] = 0.5 * (g[tuple(lo)] + g[tuple(hi)])
        g = out
    return np.clip(g, 0, 1), int(filled.sum()), len(src)


def affine_lut(src, tgt, n_out=LUT_N_OUT):
    """Smooth LUT from the robust affine pre-fit, with true black preserved."""
    keep, M = trim_outliers(src, tgt)
    ax = np.linspace(0, 1, n_out)
    R, G, B = np.meshgrid(ax, ax, ax, indexing="ij")
    centers = np.stack([R, G, B], -1).reshape(-1, 3)
    out = np.clip(apply_affine(M, centers), 0, 1).reshape(n_out, n_out, n_out, 3)

    # The affine fit has a dark pedestal because the source footage is log-like, but true
    # black/transparent edge samples should remain black when the LUT is reused in the renderer.
    luma = (centers[:, 0] * 0.2126 + centers[:, 1] * 0.7152 + centers[:, 2] * 0.0722
            ).reshape(n_out, n_out, n_out, 1)
    ramp = np.clip((luma - FX3_BLACK_RAMP_IN) / (FX3_BLACK_RAMP_OUT - FX3_BLACK_RAMP_IN), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    identity = np.stack([R, G, B], -1)
    return out * ramp + identity * (1 - ramp), float(keep.mean())


def smooth_fx3_lut(fitted_lut, src, tgt):
    """Blend sparse median-bin FX3 fit toward the smooth affine fit IN THE SHADOWS ONLY.

    The pure fitted LUT scores well on the opener pairs, but undersampled dark hair/couch
    colors can land in locally noisy bins — that is where the affine smoothing helps. A global
    blend is NOT safe: the affine cannot express the log-source tone curve, so blending it into
    well-sampled midtones dragged the whole wall ~6/255 dark-warm vs the reference (measured
    per-region against the render, 2026-07-07). Gate the blend by input-lattice luma.
    """
    n = fitted_lut.shape[0]
    smooth, keep_ratio = affine_lut(src, tgt, n)
    ax = np.linspace(0, 1, n)
    R, G, B = np.meshgrid(ax, ax, ax, indexing="ij")
    luma = (R * 0.2126 + G * 0.7152 + B * 0.0722)[..., None]
    # true blacks only: the face's shadow tones start around luma 0.15 and must stay on the
    # fitted lattice — a wider gate flattened them toward the affine
    t = np.clip((luma - 0.04) / (0.12 - 0.04), 0, 1)
    shadow_weight = FX3_SMOOTH_BLEND * (1 - t * t * (3 - 2 * t))  # full blend at black, none by luma 0.12
    return np.clip(fitted_lut * (1 - shadow_weight) + smooth * shadow_weight, 0, 1), keep_ratio


def apply_lut(img01, lut):
    """Trilinear LUT application. img01 (...,3) in [0,1]."""
    n = lut.shape[0]
    x = np.clip(img01, 0, 1) * (n - 1)
    i0 = np.clip(np.floor(x).astype(np.int32), 0, n - 2)
    f = x - i0
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
    fr, fg, fb = (f[..., 0:1], f[..., 1:2], f[..., 2:3])
    c000 = lut[r0, g0, b0]; c100 = lut[r0 + 1, g0, b0]
    c010 = lut[r0, g0 + 1, b0]; c110 = lut[r0 + 1, g0 + 1, b0]
    c001 = lut[r0, g0, b0 + 1]; c101 = lut[r0 + 1, g0, b0 + 1]
    c011 = lut[r0, g0 + 1, b0 + 1]; c111 = lut[r0 + 1, g0 + 1, b0 + 1]
    c00 = c000 * (1 - fr) + c100 * fr
    c10 = c010 * (1 - fr) + c110 * fr
    c01 = c001 * (1 - fr) + c101 * fr
    c11 = c011 * (1 - fr) + c111 * fr
    c0 = c00 * (1 - fg) + c10 * fg
    c1 = c01 * (1 - fg) + c11 * fg
    return c0 * (1 - fb) + c1 * fb


def write_cube(path, lut, title):
    lines = ["# %s" % title, "# generated by gradefit.py",
             "LUT_3D_SIZE %d" % lut.shape[0],
             "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    arr = lut.transpose(2, 1, 0, 3).reshape(-1, 3)  # b slowest, r fastest
    lines += ["%.6f %.6f %.6f" % tuple(v) for v in arr]
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


# ------------------------------------------------- the AE grade chain (known exactly)
# The comp's full-length adjustment stack applies, bottom-up: WEDDING_02.cube at 50% layer
# opacity, then Cinematic LUT 17.cube — both recovered from the Apply Color LUT effects'
# embedded device-link ICC profiles in the .aep (ae-luts/). The fit pre-applies this chain to
# the source pairs, so the lattice only learns the remaining (smooth) Lumetri/curves residual
# — sparse bins extrapolate far better, and the strongly-curved film-look part is EXACT.
# Every exported cube composes the chain back in, so the renderer keeps applying one LUT.
def read_cube(path):
    vals, size = [], 0
    for line in open(path):
        line = line.strip()
        if not line or line[0] in "#DL":
            if line.startswith("LUT_3D_SIZE"):
                size = int(line.split()[1])
            continue
        p = line.split()
        if len(p) == 3:
            vals.append([float(x) for x in p])
    data = np.array(vals).reshape(size, size, size, 3)  # cube order: [b][g][r]
    return data.transpose(2, 1, 0, 3)                    # -> [r][g][b] (apply_lut's order)


AE_LUT_DIR = os.path.join(EDL, "ae-luts")
CHAIN_WEDDING = read_cube(os.path.join(AE_LUT_DIR, "wedding-02.cube"))
CHAIN_CINEMATIC = read_cube(os.path.join(AE_LUT_DIR, "cinematic-lut-17.cube"))
WEDDING_LAYER_OPACITY = 0.5


def slog3_to_p3dci(img01):
    """Analytic stand-in for the AEP's clip-level Sony conversion LUT on the FX3 footage
    (Slog3-S-Gamut3.Cine_To_sP3DCI — referenced with __Embed but the file isn't on disk).
    Exactness doesn't matter — the residual fit absorbs the difference. What matters is the
    LOG EXPANSION: in S-Log3 code values the curtain and the warm wall sit ~5 levels apart
    (one lattice bin — unresolvable), while after decoding they separate cleanly."""
    x = np.clip(img01, 0.0, 1.0)
    # official Sony S-Log3 -> linear reflectance
    t = 171.2102946929 / 1023.0
    lin = np.where(x >= t,
                   np.power(10.0, (x * 1023.0 - 420.0) / 261.5) * 0.19 - 0.01,
                   (x * 1023.0 - 95.0) * 0.01125 / (171.2102946929 - 95.0))
    lin = np.clip(lin, 0.0, None)
    # S-Gamut3.Cine -> XYZ(D65) -> P3 (documented primaries)
    M1 = np.array([[0.599839, 0.248940, 0.102362],
                   [0.215432, 0.885671, -0.101103],
                   [-0.032043, -0.027658, 1.148804]])
    M2 = np.array([[2.493497, -0.931384, -0.402711],
                   [-0.829489, 1.762664, 0.023625],
                   [0.035846, -0.076172, 0.956885]])
    rgb = np.einsum("ij,...j->...i", M2 @ M1, lin)
    return np.power(np.clip(rgb, 0.0, 1.0), 1.0 / 2.6)


def chain_apply(img01, fx3=False):
    x = np.clip(img01, 0, 1)
    if fx3:
        x = slog3_to_p3dci(x)
    x = x + WEDDING_LAYER_OPACITY * (apply_lut(x, CHAIN_WEDDING) - x)
    return apply_lut(x, CHAIN_CINEMATIC)


def compose_chain_out(fitted_lut, n_out=LUT_N_OUT, fx3=False):
    """total(x) = fitted(chain(x)) sampled on the export lattice. The FX3 chain starts with
    the steep log decode, so its export uses a finer lattice to keep interpolation honest."""
    if fx3:
        n_out = 65
    ax = np.linspace(0, 1, n_out)
    R, G, B = np.meshgrid(ax, ax, ax, indexing="ij")
    pts = np.stack([R, G, B], -1)
    return np.clip(apply_lut(chain_apply(pts, fx3=fx3), fitted_lut), 0, 1)


def psnr(a, b):
    mse = float(np.mean((a - b) ** 2))
    return 99.0 if mse < 1e-12 else 10.0 * np.log10(1.0 / mse)


# ---------------------------------------------------------------- main
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(PREV_DIR, exist_ok=True)
    d = np.load(os.path.join(EDL, "pairs.npz"), allow_pickle=True)
    target, source, seg = d["target"], d["source"], [str(x) for x in d["seg"]]
    segs = sorted(set(seg))
    # pre-apply the exact AE chain to every source pair; the fit learns only the residual.
    # FX3 clips additionally get the clip-level S-Log3 decode at the head (see slog3_to_p3dci)
    source = np.stack([
        np.clip(np.round(chain_apply(s.astype(np.float64) / 255.0, fx3=(sg in FX3_SEGS)) * 255.0), 0, 255).astype(np.uint8)
        for s, sg in zip(source, seg)
    ])

    # 1. align + mask + sample
    samples = defaultdict(lambda: ([], []))      # seg -> (src_list, tgt_list)
    eval_px = defaultdict(lambda: ([], []))      # masked aligned pixels for PSNR
    align_info, excluded_pairs = {}, []
    chosen_src = {}                              # pair index -> best-candidate source frame
    for i in range(len(seg)):
        t8 = target[i]
        # pairs carry several source-time candidates (pairs2 CANDIDATE_OFFSETS) — align each
        # and keep the best NCC: sub-frame timing error on moving content otherwise pollutes
        # flat-region samples (misaligned skin pairs pass the mask and flatten the fit)
        cands = source[i] if source[i].ndim == 4 else source[i][None]
        best = None
        for s8c in cands:
            a, v, n, p = align_pair(s8c, t8)
            if best is None or n > best[2]:
                best = (a, v, n, p, s8c)
        aligned, valid, nccv, params, s8 = best
        chosen_src[i] = s8
        align_info[i] = dict(seg=seg[i], ncc=round(nccv, 3),
                             scale=round(params[0], 3),
                             ty=round(float(params[1]), 1),
                             tx=round(float(params[2]), 1))
        if nccv < PAIR_NCC_MIN:
            excluded_pairs.append(i)
            continue
        t01 = t8.astype(np.float64) / 255.0
        mask = local_ncc_mask(aligned, valid, t01)
        if mask.sum() < 3000:
            excluded_pairs.append(i)
            continue
        sp = aligned[mask]
        tp = t01[mask]
        if len(sp) > 150000:
            pick = RNG.choice(len(sp), 150000, replace=False)
            sp, tp = sp[pick], tp[pick]
        samples[seg[i]][0].append(sp)
        samples[seg[i]][1].append(tp)
        eval_px[seg[i]][0].append(sp)
        eval_px[seg[i]][1].append(tp)

    seg_samples = {k: (np.vstack(v[0]), np.vstack(v[1]))
                   for k, v in samples.items()}
    usable_segs = sorted(seg_samples.keys())
    normal_segs = [s for s in usable_segs if s not in FX3_SEGS]

    # 2. global (normal) + fx3 fits
    gsrc = np.vstack([seg_samples[s][0] for s in normal_segs])
    gtgt = np.vstack([seg_samples[s][1] for s in normal_segs])
    global_lut, gbins, gns = fit_lut(gsrc, gtgt)
    write_cube(os.path.join(OUT_DIR, "global.cube"), compose_chain_out(global_lut),
               "framediff hero grade: global (rec709 segments; AE chain composed)")

    luts = {"global": global_lut}
    fx3_present = [s2 for s2 in sorted(FX3_SEGS) if s2 in seg_samples]
    if fx3_present:
        # pool ALL aligned FX3-camera segments: the phone shot's screen-lit skin occupies
        # color bins the dim opener never populates — fitting on open alone left the phone
        # face ~7/255 short of the reference's warmth (r-g separation compressed)
        fsrc = np.vstack([seg_samples[s2][0] for s2 in fx3_present])
        ftgt = np.vstack([seg_samples[s2][1] for s2 in fx3_present])
        # finer lattice for the FX3 family: at 17^3 the diffusion smoothing pulls the
        # saturated skin bins toward their more-neutral neighbors (~5/255 of r-g separation
        # on the phone shot's screen-lit face); the pooled open+phone samples support 21^3
        fx3_fitted_lut, fbins, fns = fit_lut(fsrc, ftgt, n_fit=21, n_out=41)
        fx3_lut, faff_keep = smooth_fx3_lut(fx3_fitted_lut, fsrc, ftgt)
        write_cube(os.path.join(OUT_DIR, "fx3.cube"), compose_chain_out(fx3_lut, fx3=True),
                   "framediff hero grade: FX3 smoothed fit (open/phone; AE chain composed)")
        luts["fx3"] = fx3_lut
    else:
        fbins = fns = 0
        faff_keep = 0.0

    # 3. per-seg fits + selection
    manifest = {"segments": {}, "metrics": {}}
    rows = []
    for s in usable_segs:
        sp, tp = eval_px[s]
        sp, tp = np.vstack(sp), np.vstack(tp)
        p_id = psnr(sp, tp)
        p_gl = psnr(apply_lut(sp, global_lut), tp)
        if s in FX3_SEGS:
            p_fx3 = psnr(apply_lut(sp, luts["fx3"]), tp)
            chosen, p_used, p_own = "fx3.cube", p_fx3, p_fx3
            # phone historically had no usable pairs (its comp window sits at 77-87% of the
            # 4K source — alignment scale ~0.6, below the old search floor) and borrowed the
            # opener's fit, extrapolating pale in bins the opener never populated. With its
            # pairs aligning it earns its own FX3-family fit under the usual gain gate.
            if s != "open" and s in seg_samples:
                own_fitted, _, _ = fit_lut(*seg_samples[s])
                own_lut, _ = smooth_fx3_lut(own_fitted, *seg_samples[s])
                p_own = psnr(apply_lut(sp, own_lut), tp)
                npairs = sum(1 for x in seg if x == s)
                if p_own - p_fx3 > PER_SEG_GAIN_DB and npairs >= 3:
                    write_cube(os.path.join(OUT_DIR, "%s.cube" % s), compose_chain_out(own_lut, fx3=True),
                               "framediff hero grade: per-segment FX3 fit for %s (AE chain composed)" % s)
                    luts[s] = own_lut
                    chosen, p_used = "%s.cube" % s, p_own
        else:
            own_lut, _, _ = fit_lut(*seg_samples[s])
            p_own = psnr(apply_lut(sp, own_lut), tp)
            npairs = sum(1 for x in seg if x == s)
            if p_own - p_gl > PER_SEG_GAIN_DB and npairs >= 3:
                write_cube(os.path.join(OUT_DIR, "%s.cube" % s), compose_chain_out(own_lut),
                           "framediff hero grade: per-segment fit for %s (AE chain composed)" % s)
                luts[s] = own_lut
                chosen, p_used = "%s.cube" % s, p_own
            else:
                chosen, p_used = "global.cube", p_gl
        manifest["segments"][s] = chosen
        manifest["metrics"][s] = {"psnr_global": round(p_gl, 2),
                                  "psnr_used": round(p_used, 2)}
        rows.append((s, p_id, p_gl, p_own, chosen))

    # per-shot gain-calibrated FX3 cubes override the family cube (see FX3_OUTPUT_GAIN)
    if "fx3" in luts:
        base = compose_chain_out(luts["fx3"], fx3=True)
        for seg_name, gain in FX3_OUTPUT_GAIN.items():
            write_cube(os.path.join(OUT_DIR, "%s.cube" % seg_name),
                       np.clip(base * np.array(gain), 0, 1),
                       "framediff hero grade: FX3 fit with measured output gain for %s" % seg_name)
            manifest["segments"][seg_name] = "%s.cube" % seg_name

    # phone: no pairs, same camera+LUT as open
    if "open" in seg_samples:
        manifest["segments"].setdefault("phone", "fx3.cube")
    for s in segs:
        if s not in manifest["segments"]:
            manifest["segments"][s] = "global.cube"   # excluded: fall back

    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)

    # 4. previews: [raw source | graded(chosen) | target], middle pair per seg
    for s in segs:
        idxs = [i for i in range(len(seg)) if seg[i] == s]
        i = idxs[len(idxs) // 2]
        cand_mid = source[i][source[i].shape[0] // 2] if source[i].ndim == 4 else source[i]
        s01 = chosen_src.get(i, cand_mid).astype(np.float64) / 255.0
        lut_name = manifest["segments"].get(s, "global.cube").replace(".cube", "")
        lut = luts.get(lut_name if lut_name in luts else
                       ("fx3" if lut_name == "fx3" else "global"), luts["global"])
        graded = apply_lut(s01, lut)
        strip = np.hstack([s01, graded, target[i].astype(np.float64) / 255.0])
        Image.fromarray((np.clip(strip, 0, 1) * 255 + 0.5).astype(np.uint8)
                        ).save(os.path.join(PREV_DIR, "%s.png" % s))

    # 5. report
    rep = ["# gradefit report", "",
           "Method: per-pair scale+translation alignment (coarse-to-fine gray",
           "NCC: level-4 scan s in [0.8,1.6] step .04 / +-40 px, level-2 and",
           "full-res refine), 9x9 local-NCC masking (keep NCC>=0.6 structured",
           "or mutually-flat windows; drops caption/overlay pixels), robust",
           "affine pre-fit with outlier trimming, then 17^3 median-bin lattice",
           "with screened-diffusion fill (init = affine extrapolation),",
           "upsampled to 33^3 .cube (R fastest, domain [0,1]).", "",
           "Global LUT fitted on all normal (rec709) segments (%d bins filled,"
           % gbins, "%d samples). FX3 LUT fitted on 'open'; 'phone' shares it."
           % gns, "",
           "FX3 smoothing: median-bin LUT blended %.0f%% toward a robust affine fit"
           % (FX3_SMOOTH_BLEND * 100.0),
           "(%d bins, %d samples, %.1f%% affine inliers), with a near-black identity ramp."
           % (fbins, fns, faff_keep * 100.0), "",
           "| segment | pairs | PSNR identity | PSNR global | PSNR own-fit | chosen |",
           "|---|---|---|---|---|---|"]
    for s, p_id, p_gl, p_own, chosen in rows:
        rep.append("| %s | %d | %.2f | %.2f | %.2f | %s |"
                   % (s, sum(1 for x in seg if x == s), p_id, p_gl, p_own, chosen))
    rep += ["", "## Alignment (per pair)", "",
            "| # | seg | scale | ty | tx | NCC |", "|---|---|---|---|---|---|"]
    for i, a in align_info.items():
        rep.append("| %d | %s | %.3f | %.1f | %.1f | %.3f |"
                   % (i, a["seg"], a["scale"], a["ty"], a["tx"], a["ncc"]))
    if excluded_pairs:
        rep += ["", "Excluded pairs (NCC<%.2f or too few valid px): %s"
                % (PAIR_NCC_MIN, ", ".join("%d(%s)" % (i, seg[i])
                                           for i in excluded_pairs))]
    else:
        rep += ["", "No pairs excluded."]
    rep += ["", "PSNR is computed on aligned, NCC-masked pixels (fair for",
            "color-only comparison; unmasked full-frame PSNR would be",
            "dominated by spatial mismatch and overlay text)."]
    with open(os.path.join(EDL, "gradefit-report.md"), "w") as f:
        f.write("\n".join(rep) + "\n")

    print("\n".join(rep))
    print("\nLUT(0,0,0):")
    for k, v in luts.items():
        print(" ", k, np.round(v[0, 0, 0], 3), " LUT(1,1,1):",
              np.round(v[-1, -1, -1], 3))


if __name__ == "__main__":
    main()
