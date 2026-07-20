#!/usr/bin/env python3
"""EDL finalization: per-sub-cut alignment with optional region crops and scale search.
Outputs edl.json: per segment {clip, f0, f1, src_at_f0, speed, per-frame scores}."""
import os, json, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/path/to/after-effects-project"
TARGET = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
FPS_T = 24000 / 1001
W, H = 128, 72

from refine import PATHS, grab, vecs  # reuse extractors
import glob as _g
PATHS = dict(PATHS)
PATHS["screenrec"] = os.path.relpath(_g.glob(os.path.join(ROOT, "(Footage)/arquivos/Screen Recording*.mov"))[0], ROOT)
PATHS["june15"] = "(Footage)/arquivos/2026-06-15 17-29-58.mp4"

def fps_of(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", p],
                       capture_output=True, text=True).stdout.strip()
    a, b = (r.split("/") + ["1"])[:2]
    return float(a) / float(b)

def crop_half(a, side):
    w = a.shape[2]
    return a[:, :, : w // 2] if side == "L" else a[:, :, w // 2 :]

def vecs2(a):
    a = a - a.mean(axis=(1, 2), keepdims=True)
    a = a / np.maximum(a.std(axis=(1, 2), keepdims=True), 1e-6)
    v = a.reshape(a.shape[0], -1)
    return v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-9)

# (name, clip, f0, f1, src_lo, src_hi, opts)
SEGS = [
    ("open",       "nando23",     0,   48,  2.0, 8.0, {}),
    ("phone",      "nando30",    44,   94,  3.0, 12.0, {"zoom": True}),
    ("grid",       "streamfeio", 92,  148,  1.0, 9.0, {}),
    ("news_a",     "newsroom",  144,  266,  4.0, 12.0, {}),
    ("news_b",     "newsroom",  262,  301, 12.5, 17.0, {}),
    ("news_c",     "newsroom",  297,  352, 14.5, 19.0, {}),
    ("uizoom",     "screenrec", 348,  408,  0.0, 6.0, {"thr": 0.6}),
    ("split_L",    "hf1934",    446,  492,  0.0, 4.0, {"half": "L"}),
    ("split_R",    "apr1335",   446,  492,  6.0, 11.0, {"half": "R"}),
    ("keynote_a",  "keynote1201", 518, 578, 3.5, 11.0, {"thr": 0.6}),
    ("hf_talk",    "hf1915",    605,  626,  2.0, 5.5, {}),
    ("magnific",   "magnific",  622,  642,  0.5, 5.5, {}),
    ("greenwide",  "kling_gerar", 660, 696, 0.0, 3.0, {"thr": 0.55}),
    ("desk",       "apr1352",   692,  722, 44.0, 49.0, {}),
    ("smartest",   "smartest",  718,  746, 34.0, 38.5, {}),
    ("blazer",     "kling_animar", 742, 766, 0.0, 3.0, {"thr": 0.55}),
    ("tripod",     "apr1357",   762,  812, 13.0, 20.0, {}),
    ("keynote_b",  "keynote0150", 806, 846, 10.5, 15.0, {}),
]

def main():
    tgt_full = grab(TARGET)[:971]
    out = []
    for name, cid, f0, f1, lo, hi, opt in SEGS:
        p = os.path.join(ROOT, PATHS[cid])
        fpsn = fps_of(p)
        cand = grab(p, ss=lo, t=(hi - lo) + (f1 - f0) / FPS_T + 2)
        tseg = tgt_full[f0:f1].copy()
        if opt.get("half"):
            tv = vecs2(crop_half(tseg, opt["half"]))
            cvv = vecs2(crop_half(cand, opt["half"]))
        elif opt.get("zoom"):
            # target is a zoom-in of the source: crop candidate center at several scales
            best_s, best_pack = -1, None
            for z in [1.0, 1.15, 1.3, 1.45, 1.6]:
                ch, cw = int(H / z), int(W / z)
                y0, x0 = (H - ch) // 2, (W - cw) // 2
                cc = cand[:, y0 : y0 + ch, x0 : x0 + cw]
                # resize via numpy (nearest) to H,W
                yi = (np.arange(H) * ch / H).astype(int)
                xi = (np.arange(W) * cw / W).astype(int)
                cc = cc[:, yi][:, :, xi]
                tv_, cv_ = vecs2(tseg), vecs2(cc)
                s = tv_ @ cv_.T
                if s.max() > best_s:
                    best_s, best_pack, bz = s.max(), (tv_, cv_), z
            tv, cvv = best_pack
            print(f"  [{name}] zoom≈{bz} best={best_s:.3f}")
        else:
            tv, cvv = vecs2(tseg), vecs2(cand)
        s = tv @ cvv.T
        j = s.argmax(axis=1)
        sc = s[np.arange(f1 - f0), j]
        src_t = max(0, lo) + j / fpsn
        thr = opt.get("thr", 0.72)
        m = sc > thr
        rec = {"name": name, "clip": cid, "f0": f0, "f1": f1,
               "scores": [round(float(x), 3) for x in sc]}
        if m.sum() >= 4:
            for _ in range(2):
                x = np.arange(f0, f1)[m] / FPS_T
                y = src_t[m]
                A = np.vstack([x, np.ones_like(x)]).T
                beta, alpha = np.linalg.lstsq(A, y, rcond=None)[0]
                resid = np.abs(A @ [beta, alpha] - y)
                keep = resid < 0.13
                if keep.all():
                    break
                idx = np.where(m)[0][~keep]
                m[idx] = False
                if m.sum() < 4:
                    break
            rec.update(speed=round(float(beta), 4),
                       src_at_f0=round(float(alpha + beta * f0 / FPS_T), 3),
                       conf=int(m.sum()))
        out.append(rec)
        print(f"{name:10s} {cid:12s} f{f0}-{f1} speed={rec.get('speed','—'):>7} "
              f"src@f0={rec.get('src_at_f0','—'):>8} conf={rec.get('conf',0):>3} "
              f"medscore={float(np.median(sc)):.3f}")
    json.dump(out, open(os.path.join(HERE, "edl.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
