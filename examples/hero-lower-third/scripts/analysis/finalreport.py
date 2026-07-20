#!/usr/bin/env python3
"""Final parity report: full-video SSIM + per-segment means vs the reference."""
import subprocess, json, sys, re, os
import numpy as np

OURS = "/path/to/framediff/examples/hero-lower-third/out/hero-raw-full.mp4"
REF = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
HERE = os.path.dirname(os.path.abspath(__file__))

r = subprocess.run(["ffmpeg", "-hide_banner", "-i", OURS, "-i", REF,
                    "-lavfi", "ssim=stats_file=" + os.path.join(HERE, "ssim-final.log"),
                    "-f", "null", "-"], capture_output=True, text=True)
m = re.search(r"SSIM Y:([\d.]+).*All:([\d.]+)", r.stderr)
print("overall:", m.group(0) if m else "?")

SEGS = [(0,46,"open"),(46,92,"phone"),(92,145,"grid"),(145,264,"news_a"),(264,297,"news_b"),
        (297,349,"news_c"),(349,406,"uizoom"),(406,448,"june3d"),(448,490,"split"),
        (490,518,"cam4"),(518,566,"keynote_a"),(566,605,"allyou"),(605,625,"hf_talk"),
        (625,640,"magnific"),(640,660,"cam6"),(660,692,"greenwide"),(692,718,"desk"),
        (718,744,"smartest"),(744,764,"blazer"),(764,808,"tripod"),(808,843,"keynote_b"),
        (843,897,"bumper"),(897,971,"closing"),(971,1091,"endcard")]
vals = {}
for line in open(os.path.join(HERE, "ssim-final.log")):
    mm = re.match(r"n:(\d+) .*All:([\d.]+)", line)
    if mm:
        vals[int(mm.group(1)) - 1] = float(mm.group(2))
print(f"{'segment':12s} {'frames':>10s} {'SSIM':>7s}")
rows = []
for a, b, name in SEGS:
    xs = [vals[i] for i in range(a, b) if i in vals]
    if xs:
        rows.append((name, a, b, sum(xs)/len(xs)))
        print(f"{name:12s} {a:4d}-{b:4d} {sum(xs)/len(xs):7.3f}")
json.dump({"rows": rows}, open(os.path.join(HERE, "final-ssim.json"), "w"))
