#!/usr/bin/env python3
"""Extract downscaled grayscale frames from the target + all raw clips into .npz files."""
import subprocess, sys, os, json
import numpy as np

W, H = 96, 54
TARGET = "/path/to/reference-project/out/hero-with-lower-third/hero-with-lower-third.mp4"
ROOT = "/path/to/after-effects-project"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(OUT, exist_ok=True)

CLIPS = {  # id -> (path, sample_fps)
    "nando23": ("(Footage)/arquivos/NANDO_FX3_0023.mp4", 6),
    "nando30": ("(Footage)/arquivos/NANDO_FX3_0030.mp4", 6),
    "streamfeio": ("(Footage)/arquivos/stream feio.mp4", 6),
    "newsroom": ("(Footage)/arquivos/latest2ar2_lighttwistnewsroom-2026-06-17-21-40-53.mp4", 6),
    "screenrec": ("(Footage)/arquivos/Screen Recording 2026-06-17 at 3.52.13 PM.mov", 6),
    "june15": ("(Footage)/arquivos/2026-06-15 17-29-58.mp4", 6),
    "apr1335": ("(Footage)/arquivos/2026-04-24 13-35-32.mp4", 6),
    "apr1352": ("(Footage)/arquivos/2026-04-24 13-52-20.mp4", 6),
    "apr1357": ("(Footage)/arquivos/2026-04-24 13-57-01.mp4", 6),
    "explicacao": ("(Footage)/arquivos/explicacao-interface-nova.mp4", 2),
    "keynote1201": ("(Footage)/arquivos/latest2ar2_bright-keynote-2026-06-15-16-12-27.mp4", 6),
    "keynote0150": ("(Footage)/arquivos/latest2ar2_bright-keynote-2026-06-15-16-01-50.mp4", 6),
    "smartest": ("(Footage)/arquivos/latest2br1_SmartestPerson_Standalone-2026-05-12-13-47-09.mp4", 6),
    "hf1915": ("(Footage)/arquivos/hf_20260617_191556_e93008c8-2fd0-4ce8-bdd9-1b6b52ead4a0.mp4", 8),
    "hf1934": ("(Footage)/arquivos/hf_20260617_193427_539e8457-d7ac-46a5-b9c8-c8b90271c001.mp4", 8),
    "magnific": ("(Footage)/arquivos/magnific_video-upscale_3009454435.mp4", 8),
    "kling_animar": ("(Footage)/arquivos/kling_20260527_作品_animar_as__5514_0_prob4.mov", 8),
    "kling_gerar": ("(Footage)/arquivos/kling_20260527_作品_gerar_uma__2957_0_prob4.mov", 8),
    "person_blue": ("Person_in_blue_speaks_202606161015_prob4_prob4.mp4", 6),
    "mask_hf1": ("Stream mask folder/(Footage)/ARQUIVOS/hf_20260615_114815_17f6cbf6-086d-48d4-a683-4c4c0207ee72.mp4", 6),
    "mask_hf2": ("Stream mask folder/(Footage)/ARQUIVOS/hf_20260615_114007_35ce6599-9ec9-4fda-8d38-3e72815fc94a.mp4", 6),
    "mask_hf3": ("Stream mask folder/(Footage)/ARQUIVOS/hf_20260615_114411_0f46e2f4-7ace-4b28-8219-f482e53ceab2.mp4", 6),
    "mask_hf4": ("Stream mask folder/(Footage)/ARQUIVOS/hf_20260615_114208_a51602d5-1c0c-4b1e-8f4f-1b553b0303f4.mp4", 6),
    "flare": ("(Footage)/arquivos/Logo Reveal 23.x.aep/3. Do not Touch/Flare.mp4", 6),
    "optflare": ("(Footage)/arquivos/Logo Reveal 23.x.aep/3. Do not Touch/Optical Flare.mp4", 6),
}

def grab(path, fps=None, vframes=None):
    """Return (frames float32 [N,H,W] mean0/std1, times) sampled at fps (or native if None)."""
    vf = f"scale={W}:{H},format=gray"
    cmd = ["ffmpeg", "-v", "error", "-i", path]
    if fps: vf = f"fps={fps}," + vf
    cmd += ["-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    n = len(raw) // (W * H)
    a = np.frombuffer(raw[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.float32)
    return a

def norm(a):
    a = a - a.mean(axis=(1, 2), keepdims=True)
    s = a.std(axis=(1, 2), keepdims=True)
    return a / np.maximum(s, 1e-6)

def main():
    # target: hero portion only (first 971 frames @ 23.976), native fps
    tpath = os.path.join(OUT, "target.npz")
    if not os.path.exists(tpath):
        a = grab(TARGET)  # native 23.976 → all 1091
        a = a[:971]
        np.savez_compressed(tpath, frames=norm(a).astype(np.float16))
        print(f"target: {a.shape[0]} frames")
    for cid, (rel, fps) in CLIPS.items():
        p = os.path.join(ROOT, rel)
        outp = os.path.join(OUT, f"clip_{cid}.npz")
        if os.path.exists(outp):
            continue
        if not os.path.exists(p):
            print(f"MISSING: {cid} {p}", file=sys.stderr)
            continue
        a = grab(p, fps=fps)
        times = np.arange(a.shape[0]) / fps
        np.savez_compressed(outp, frames=norm(a).astype(np.float16), times=times, fps=fps)
        print(f"{cid}: {a.shape[0]} frames @ {fps}fps")

if __name__ == "__main__":
    main()
