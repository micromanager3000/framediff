#!/usr/bin/env python3
"""Segment boundaries + dissolve windows from adjacent score curves, → final-edl.json.
Also emits color frame pairs (target RGB vs mapped source RGB) for grade fitting."""
import os, json, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/path/to/after-effects-project"
TARGET = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
FPS_T = 24000 / 1001
from refine2 import PATHS

edl = json.load(open(os.path.join(HERE, "edl.json")))
by = {e["name"]: e for e in edl}

# ordered visible segments with authoritative timing (fits where confident, spec elsewhere)
# (name, clip, hard_start_f, hard_end_f, src_at_start, speed)   src/speed None → from fit
ORDER = [
    ("open",      "nando23",    0,    None, None, None),
    ("phone",     "nando30",    None, None, 4.90, 1.0),    # spec; transform shot
    ("grid",      "streamfeio", None, None, None, None),
    ("news_a",    "newsroom",   None, None, None, None),
    ("news_b",    "newsroom",   None, None, None, None),
    ("news_c",    "newsroom",   None, None, None, None),
    ("uizoom",    "screenrec",  None, 406,  0.00, 1.0),    # spec; 3D plane
    ("june3d",    "june15",     406,  448,  28.17, 1.0),   # spec; 3D plane (Cam 3)
    ("split",     "hf1934",     448,  490,  0.50, 1.0),    # split L; R = apr1335 (fit visually)
    ("cam4",      "explicacao", 490,  527,  None, 1.0),    # 3D plane; src via visual
    ("keynote_a", "keynote1201", None, 566, None, None),
    ("allyou",    None,         566,  607,  None, None),   # 3D text card (code)
    ("hf_talk",   "hf1915",     None, None, None, None),
    ("magnific",  "magnific",   None, None, 1.20, 3.0),    # short/fast; spec-in, fit speed noisy
    ("cam6",      "explicacao", 640,  662,  None, 1.0),    # 3D plane
    ("greenwide", "kling_gerar", None, None, None, None),
    ("desk",      "apr1352",    None, None, None, None),
    ("smartest",  "smartest",   None, None, None, None),
    ("blazer",    "kling_animar", None, None, None, None),
    ("tripod",    "apr1357",    None, None, None, None),
    ("keynote_b", "keynote0150", None, 843, None, None),
    ("bumper",    None,         843,  897,  None, None),   # code (glass wordmark)
    ("closing",   None,         897,  971,  None, None),   # code (text card)
]

def curve(name):
    e = by.get(name)
    if not e:
        return None
    return e["f0"], np.array(e["scores"])

# boundary between consecutive fitted segments: score crossover
def crossover(a, b, lo, hi):
    ca, cb = curve(a), curve(b)
    if not ca or not cb:
        return None
    xs = range(max(lo, ca[0], cb[0]), min(hi, ca[0] + len(ca[1]), cb[0] + len(cb[1])))
    best, bf = None, None
    for f in xs:
        d = ca[1][f - ca[0]] - cb[1][f - cb[0]]
        if best is None or abs(d) < best:
            best, bf = abs(d), f
    return bf

final = []
for i, (name, clip, hs, he, src0, spd) in enumerate(ORDER):
    e = by.get(name, {})
    start = hs
    if start is None:
        prev = ORDER[i - 1][0]
        start = crossover(prev, name, e.get("f0", 0), e.get("f1", 971))
        if start is None:
            start = e.get("f0")
    final.append({
        "name": name, "clip": clip, "start": int(start),
        "src0": src0 if src0 is not None else e.get("src_at_f0"),
        "speed": spd if spd is not None else e.get("speed", 1.0),
        "fit_f0": e.get("f0"),
    })
# ends = next start; last visible ends at 843 hard
for i, f in enumerate(final):
    f["end"] = final[i + 1]["start"] if i + 1 < len(final) else 971
# adjust src0 to the segment's actual start (fits report src at fit_f0)
for f in final:
    if f["src0"] is not None and f["fit_f0"] is not None and by.get(f["name"], {}).get("src_at_f0") == f["src0"]:
        f["src0"] = round(f["src0"] + (f["start"] - f["fit_f0"]) / FPS_T * (f["speed"] or 1.0), 3)
    f.pop("fit_f0", None)

json.dump(final, open(os.path.join(HERE, "final-edl.json"), "w"), indent=1)
for f in final:
    print(f"{f['start']:4d}-{f['end']:4d}  {f['name']:10s} {str(f['clip']):14s} src0={f['src0']} speed={f['speed']}")

# ---- color pairs for grade fitting (confident flat segments only) ----
def grab_rgb(path, ss, n=1, fps=None):
    cmd = ["ffmpeg", "-v", "error", "-ss", str(max(0, ss)), "-i", path,
           "-vf", "scale=480:270", "-frames:v", str(n), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    k = len(raw) // (480 * 270 * 3)
    return np.frombuffer(raw[: k * 480 * 270 * 3], dtype=np.uint8).reshape(k, 270, 480, 3)

PAIR_SEGS = ["open", "grid", "news_a", "news_b", "news_c", "hf_talk", "greenwide",
             "desk", "smartest", "tripod", "keynote_b", "keynote_a", "magnific", "blazer"]
pairs_t, pairs_s, seg_ids = [], [], []
for f in final:
    if f["name"] not in PAIR_SEGS or f["src0"] is None:
        continue
    p = os.path.join(ROOT, PATHS[f["clip"]])
    n = f["end"] - f["start"]
    for frac in (0.25, 0.5, 0.75):
        tf = int(f["start"] + frac * n)
        st = f["src0"] + (tf - f["start"]) / FPS_T * f["speed"]
        t_img = grab_rgb(TARGET, tf / FPS_T + 0.02)  # +half frame
        s_img = grab_rgb(p, st + 0.02)
        if len(t_img) and len(s_img):
            pairs_t.append(t_img[0]); pairs_s.append(s_img[0]); seg_ids.append(f["name"])
np.savez_compressed(os.path.join(HERE, "pairs.npz"),
                    target=np.array(pairs_t), source=np.array(pairs_s), seg=np.array(seg_ids))
print(f"pairs: {len(pairs_t)} from {len(set(seg_ids))} segments")
