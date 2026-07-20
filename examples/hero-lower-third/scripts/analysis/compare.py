#!/usr/bin/env python3
"""Compare probe bakes vs target frames: metrics table + stacked side-by-side sheets.

Usage: compare.py [probe-id]   (default hero-raw; use `main` for the full composite)
"""
import os, sys, glob, subprocess
import numpy as np

OUT = "/path/to/framediff/examples/hero-lower-third/out"
TARGET = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
HERE = os.path.dirname(os.path.abspath(__file__))
FPS_T = 24000 / 1001
PROBE_ID = sys.argv[1] if len(sys.argv) > 1 else "hero-raw"
# The reference composite samples the hero one frame late: reference frame M shows comp frame
# M−1 (verified at six cut boundaries — every cut lands at grid+1 in the mp4).
REF_OFFSET = 1
SEGN = {23:"open",69:"phone",118:"grid",200:"news_a",280:"news_b",320:"news_c",375:"uizoom",
        425:"june3d",468:"split",504:"cam4",540:"keynote_a",585:"allyou",615:"hf_talk",
        632:"magnific",650:"cam6",668:"greenwide",683:"greentrack",705:"desk",730:"smartest",754:"blazer",
        785:"tripod",825:"keynote_b",870:"bumper",930:"closing"}

def png(path, w=480, h=270):
    cmd = ["ffmpeg","-v","error","-i",path,"-vf",f"scale={w}:{h}","-f","rawvideo","-pix_fmt","rgb24","-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw[:w*h*3], dtype=np.uint8).reshape(h,w,3).astype(np.float32)

def tframe(n, w=480, h=270):
    cmd = ["ffmpeg","-v","error","-i",TARGET,"-vf",f"select=eq(n\\,{n}),scale={w}:{h}","-frames:v","1",
           "-f","rawvideo","-pix_fmt","rgb24","-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw[:w*h*3], dtype=np.uint8).reshape(h,w,3).astype(np.float32)

rows = []
sheets = []
for f in sorted(SEGN):
    p = os.path.join(OUT, f"probe-{PROBE_ID}-f{f}.png")
    if not os.path.exists(p): continue
    ours = png(p); ref = tframe(f + REF_OFFSET)
    mse = ((ours-ref)**2).mean()
    psnr = 10*np.log10(255*255/max(mse,1e-6))
    # normalized gray NCC (structure)
    def g(a):
        x = a.mean(axis=2); x -= x.mean(); return x/ (x.std()+1e-6)
    ncc = float((g(ours)*g(ref)).mean())
    rows.append((f, SEGN[f], psnr, ncc))
    pair = np.concatenate([ref, ours], axis=1)  # target | ours
    sheets.append(pair.astype(np.uint8))
print(f"{'frame':>6} {'seg':12s} {'PSNR':>6} {'NCC':>6}")
for f, s, p, n in rows:
    flag = " ← LOW" if n < 0.75 else ""
    print(f"{f:6d} {s:12s} {p:6.2f} {n:6.3f}{flag}")

# write sheets, 6 rows per image
os.makedirs(os.path.join(HERE, "cmp2"), exist_ok=True)
for i in range(0, len(sheets), 6):
    block = np.concatenate(sheets[i:i+6], axis=0)
    import struct, zlib
    def save_png(path, arr):
        hgt, wid, _ = arr.shape
        raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(hgt))
        def chunk(t, d):
            c = t + d
            return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))
        png_bytes = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", wid, hgt, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
        open(path, "wb").write(png_bytes)
    save_png(os.path.join(HERE, "cmp2", f"sheet{i//6}.png"), block)
print("sheets in", os.path.join(HERE, "cmp2"))
