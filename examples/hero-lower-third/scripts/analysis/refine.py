#!/usr/bin/env python3
"""Fine alignment per segment: exact source offset, speed, and score curves (dissolve windows)."""
import os, sys, glob, json, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/path/to/after-effects-project"
TARGET = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
FPS_T = 24000 / 1001
W, H = 128, 72

PATHS = {
    "nando23": "(Footage)/arquivos/NANDO_FX3_0023.mp4",
    "nando30": "(Footage)/arquivos/NANDO_FX3_0030.mp4",
    "streamfeio": "(Footage)/arquivos/stream feio.mp4",
    "newsroom": "(Footage)/arquivos/latest2ar2_lighttwistnewsroom-2026-06-17-21-40-53.mp4",
    "june15": "(Footage)/arquivos/2026-06-15 17-29-58.mp4",
    "apr1335": "(Footage)/arquivos/2026-04-24 13-35-32.mp4",
    "apr1352": "(Footage)/arquivos/2026-04-24 13-52-20.mp4",
    "apr1357": "(Footage)/arquivos/2026-04-24 13-57-01.mp4",
    "keynote1201": "(Footage)/arquivos/latest2ar2_bright-keynote-2026-06-15-16-12-27.mp4",
    "keynote0150": "(Footage)/arquivos/latest2ar2_bright-keynote-2026-06-15-16-01-50.mp4",
    "smartest": "(Footage)/arquivos/latest2br1_SmartestPerson_Standalone-2026-05-12-13-47-09.mp4",
    "hf1915": "(Footage)/arquivos/hf_20260617_191556_e93008c8-2fd0-4ce8-bdd9-1b6b52ead4a0.mp4",
    "hf1934": "(Footage)/arquivos/hf_20260617_193427_539e8457-d7ac-46a5-b9c8-c8b90271c001.mp4",
    "magnific": "(Footage)/arquivos/magnific_video-upscale_3009454435.mp4",
    "kling_animar": "(Footage)/arquivos/kling_20260527_作品_animar_as__5514_0_prob4.mov",
    "kling_gerar": "(Footage)/arquivos/kling_20260527_作品_gerar_uma__2957_0_prob4.mov",
}

def grab(path, ss=None, t=None, fps=None):
    cmd = ["ffmpeg", "-v", "error"]
    if ss is not None:
        cmd += ["-ss", str(max(0, ss))]
    if t is not None:
        cmd += ["-t", str(t)]
    cmd += ["-i", path, "-vf", (f"fps={fps}," if fps else "") + f"scale={W}:{H},format=gray",
            "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    n = len(raw) // (W * H)
    return np.frombuffer(raw[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.float32)

def norm(a):
    a = a - a.mean(axis=(1, 2), keepdims=True)
    return a / np.maximum(a.std(axis=(1, 2), keepdims=True), 1e-6)

def vecs(a):
    v = norm(a).reshape(a.shape[0], -1)
    return v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-9)

# SEGMENTS: (clip, f0, f1, src_guess_at_f0) — from coarse + spec; f-ranges generous (overlap ok)
SEGMENTS = [
    ("nando23", 0, 50, 3.7),
    ("nando30", 40, 95, 4.9),
    ("streamfeio", 88, 150, 3.0),
    ("newsroom", 142, 355, 5.4),
    ("june15", 400, 455, 28.0),
    ("apr1335", 440, 495, 7.6),
    ("hf1934", 440, 495, 0.5),
    ("keynote1201", 515, 580, 4.5),
    ("hf1915", 600, 630, 2.8),
    ("magnific", 618, 645, 1.2),
    ("kling_gerar", 655, 700, 1.0),
    ("apr1352", 688, 726, 45.5),
    ("smartest", 715, 750, 35.2),
    ("kling_animar", 738, 770, 0.0),
    ("apr1357", 758, 815, 14.0),
    ("keynote0150", 803, 850, 11.3),
]

def main():
    tgt = grab(TARGET)[:971]
    tv = vecs(tgt)
    out = []
    for cid, f0, f1, sg in SEGMENTS:
        p = os.path.join(ROOT, PATHS[cid])
        span = (f1 - f0) / FPS_T
        ss = sg - 2.5
        cand = grab(p, ss=ss, t=span + 6)
        # native fps of candidate
        fpsn = float(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip().split("/")[0]) / \
            (float(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip().split("/")[1]) if "/" in subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip() else 1.0)
        cv = vecs(cand)
        s = tv[f0:f1] @ cv.T  # (seg_len, M)
        j = s.argmax(axis=1)
        sc = s[np.arange(f1 - f0), j]
        src_t = max(0, ss) + j / fpsn
        # robust linear fit on confident frames
        m = sc > 0.75
        rec = {"clip": cid, "f0": f0, "f1": f1,
               "scores": [round(float(x), 3) for x in sc],
               "src_t": [round(float(x), 3) for x in src_t]}
        if m.sum() >= 5:
            x = (np.arange(f0, f1)[m]) / FPS_T
            y = src_t[m]
            A = np.vstack([x, np.ones_like(x)]).T
            beta, alpha = np.linalg.lstsq(A, y, rcond=None)[0]
            resid = np.abs(A @ [beta, alpha] - y)
            m2 = m.copy()
            m2[np.where(m)[0][resid > 0.15]] = False
            if m2.sum() >= 5:
                x = (np.arange(f0, f1)[m2]) / FPS_T
                y = src_t[m2]
                A = np.vstack([x, np.ones_like(x)]).T
                beta, alpha = np.linalg.lstsq(A, y, rcond=None)[0]
            rec["speed"] = round(float(beta), 4)
            rec["src_at_f0"] = round(float(alpha + beta * f0 / FPS_T), 3)
            rec["conf_frames"] = int(m.sum())
        out.append(rec)
        print(f"{cid:12s} f{f0}-{f1}  speed={rec.get('speed','?'):>7} src@f0={rec.get('src_at_f0','?'):>8} conf={rec.get('conf_frames',0)}")
    json.dump(out, open(os.path.join(HERE, "refined.json"), "w"))

if __name__ == "__main__":
    main()
