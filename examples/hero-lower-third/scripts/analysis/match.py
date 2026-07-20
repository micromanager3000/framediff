#!/usr/bin/env python3
"""Coarse match: every target frame vs every sampled candidate frame (NCC on normalized gray)."""
import os, glob, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
FPS_T = 24000 / 1001

t = np.load(os.path.join(DATA, "target.npz"))["frames"].astype(np.float32)
N, H, W = t.shape
tv = t.reshape(N, -1)
tv /= np.linalg.norm(tv, axis=1, keepdims=True) + 1e-9

names, mats, times = [], [], []
for p in sorted(glob.glob(os.path.join(DATA, "clip_*.npz"))):
    cid = os.path.basename(p)[5:-4]
    z = np.load(p)
    f = z["frames"].astype(np.float32).reshape(z["frames"].shape[0], -1)
    f /= np.linalg.norm(f, axis=1, keepdims=True) + 1e-9
    names.append(cid)
    mats.append(f)
    times.append(z["times"])

# best score per clip per target frame
best = np.zeros((N, len(names)), dtype=np.float32)
argt = np.zeros((N, len(names)), dtype=np.float32)
for i, (f, tm) in enumerate(zip(mats, times)):
    s = tv @ f.T  # N x M
    j = s.argmax(axis=1)
    best[:, i] = s[np.arange(N), j]
    argt[:, i] = tm[j]

order = np.argsort(-best, axis=1)
rows = []
for n in range(N):
    o = order[n]
    rows.append({
        "f": n,
        "t": round(n / FPS_T, 3),
        "best": [[names[o[k]], round(float(best[n, o[k]]), 3), round(float(argt[n, o[k]]), 2)] for k in range(3)],
    })
json.dump(rows, open(os.path.join(HERE, "coarse.json"), "w"))

# quick segment view: run-length of top clip when confident
prev = None
for n in range(N):
    o = order[n][0]
    cid, sc, st = names[o], best[n, o], argt[n, o]
    label = cid if sc > 0.55 else "??"
    if label != prev:
        print(f"f{n:4d}  t={n/FPS_T:6.2f}s  {label:14s} score={sc:.3f} src_t={st:7.2f}")
        prev = label
