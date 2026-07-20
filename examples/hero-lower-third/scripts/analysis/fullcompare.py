#!/usr/bin/env python3
"""Whole-video comparison: our full render vs the reference (output test only).

Streams both videos at 480x270, pairs our frame n with reference frame n, and reports
per-shot mean PSNR / NCC plus the worst frames. Writes cmp2/fullreport.md.

Usage: fullcompare.py [ours.mp4]      (default out/hero-rebuilt-full.mp4)
"""
import os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "../../out")
OURS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT, "hero-rebuilt-full.mp4")
TARGET = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
W, H = 480, 270
REF_OFFSET = 0

SHOTS = [  # (from, to, name) comp frames — hero EDL + cards + tail
    (0, 44, "open"), (44, 91, "phone"), (91, 145, "grid"), (145, 263, "news_a"),
    (263, 297, "news_b"), (297, 348, "news_c"), (348, 406, "uizoom"), (406, 447, "june3d"),
    (447, 490, "split"), (490, 518, "cam4"), (518, 574, "keynote_a"), (574, 606, "allyou"),
    (606, 623, "hf_talk"), (623, 639, "magnific"), (639, 661, "cam6"), (661, 675, "greenwide"),
    (675, 693, "greentrack"), (693, 719, "desk"), (719, 743, "smartest"), (743, 763, "blazer"),
    (763, 782, "tripod_a"), (782, 808, "tripod_b"), (808, 842, "keynote_b"), (842, 896, "bumper"),
    (896, 971, "closing"), (971, 1090, "endcard"),
]


def reader(path, skip=0):
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    for _ in range(skip):
        p.stdout.read(W * H * 3)
    return p


def frames(p):
    n = W * H * 3
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            return
        yield np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32)


ours_p = reader(OURS)
ref_p = reader(TARGET, skip=REF_OFFSET)

psnrs, nccs = [], []
for i, (a, b) in enumerate(zip(frames(ours_p), frames(ref_p))):
    mse = ((a - b) ** 2).mean()
    psnrs.append(10 * np.log10(255 * 255 / max(mse, 1e-6)))
    ga = a.mean(axis=2); gb = b.mean(axis=2)
    ga -= ga.mean(); gb -= gb.mean()
    nccs.append(float((ga * gb).mean() / (ga.std() * gb.std() + 1e-6)))
ours_p.stdout.close(); ref_p.stdout.close()

psnrs = np.array(psnrs); nccs = np.array(nccs)
lines = [f"# Full-video comparison — {os.path.basename(OURS)} vs reference",
         "",
         f"{len(psnrs)} frame pairs · overall PSNR **{psnrs.mean():.2f} dB** · NCC **{nccs.mean():.3f}** · "
         f"median NCC {np.median(nccs):.3f}",
         "",
         "| shot | frames | PSNR | NCC | worst frame (NCC) |",
         "|---|---|---|---|---|"]
for f0, f1, name in SHOTS:
    f1c = min(f1, len(psnrs))
    if f0 >= f1c: continue
    seg_p = psnrs[f0:f1c]; seg_n = nccs[f0:f1c]
    wi = f0 + int(np.argmin(seg_n))
    flag = " ⚠" if seg_n.mean() < 0.8 else ""
    lines.append(f"| {name}{flag} | {f0}–{f1c} | {seg_p.mean():.2f} | {seg_n.mean():.3f} | f{wi} ({seg_n.min():.3f}) |")
report = "\n".join(lines) + "\n"
os.makedirs(os.path.join(HERE, "cmp2"), exist_ok=True)
open(os.path.join(HERE, "cmp2", "fullreport.md"), "w").write(report)
print(report)
