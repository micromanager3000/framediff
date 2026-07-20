#!/bin/bash
# Regenerate the hero's per-shot proxies from the RAW LightTwist footage folder.
# The reference render is never read here — raw sources only, trimmed with handles,
# normalized to h264 1920-wide for browser decode. Offsets recorded in src/data/heroEdl.ts.
set -euo pipefail

RAW="${1:-/path/to/raw-footage}"
if [ -d "$RAW/(Footage)/arquivos" ]; then
  A="$RAW/(Footage)/arquivos"
else
  A="$RAW"
fi
OUT="$(dirname "$0")/../public/raw"
mkdir -p "$OUT"

# Encode settings exist to PRESERVE FILM GRAIN — the FX3 footage is noticeably grainy and
# `-preset veryfast` used to quantize that grain into DCT blocks before the grade ever ran
# (the reference kept it, so renders looked plasticky next to AE). `-tune grain` + medium is
# the cheapest x264 combo that keeps the noise texture. Files are ~3-6× bigger; they're
# regenerable and gitignored, so only disk pays.
enc() { # enc <out> <src> <ss> <t> [width]  (width defaults 1920; pass source width for
        # clips the comp displays ABOVE 1080p — e.g. AE scales the 4K FX3 shots to 50-87%,
        # so a 1920 proxy would get upscaled at composite and smear what grain survived)
  local out="$1" src="$2" ss="$3" t="$4" w="${5:-1920}"
  [ -f "$OUT/$out" ] && { echo "skip $out"; return; }
  ffmpeg -v error -y -ss "$ss" -t "$t" -i "$src" \
    -vf "scale=${w}:-2" -an -c:v libx264 -preset medium -crf 16 -tune grain -pix_fmt yuv420p \
    "$OUT/$out"
  echo "made $out"
}

# segment            source                                              proxy-start  length
# open/phone display at 50-87% of their 4K source (AE push-ins) — keep native width
enc open.mp4        "$A/NANDO_FX3_0023.mp4"                                    2.4      3.9  3840
enc phone.mp4       "$A/NANDO_FX3_0030.mp4"                                    4.2      3.5  3840
enc grid.mp4        "$A/stream feio.mp4"                                       2.3      3.5
enc news.mp4        "$A/latest2ar2_lighttwistnewsroom-2026-06-17-21-40-53.mp4" 4.9     14.5
# the 3D-plane shots zoom INTO their sources (AE end-of-move magnification samples them at
# ~native resolution) — a 1920 proxy upscales 1.6-1.8× at the settle and melts fine detail
enc uizoom.mp4      "$A/Screen Recording"*.mov                                 0.0      3.5  3288
enc june3d.mp4      "$A/2026-06-15 17-29-58.mp4"                              27.4      3.4  3024
enc split-l.mp4     "$A/hf_20260617_193427_539e8457-d7ac-46a5-b9c8-c8b90271c001.mp4" 0.0 6.1
enc split-r.mp4     "$A/2026-04-24 13-35-32.mp4"                               6.8      3.6
# cam4/cam6 source moments come from the AEP dump (src-in 736.65 / 187.49 raw seconds) —
# NCC matching had locked onto lookalike UI screens at 497/571s; the AEP is authoritative.
enc cam4.mp4        "$A/explicacao-interface-nova.mp4"                       736.0      7.0  3024
enc cam6.mp4        "$A/explicacao-interface-nova.mp4"                       187.0      4.0  3024
enc keynote-a.mp4   "$A/latest2ar2_bright-keynote-2026-06-15-16-12-27.mp4"     4.2      7.0
enc hf-talk.mp4     "$A/hf_20260617_191556_e93008c8-2fd0-4ce8-bdd9-1b6b52ead4a0.mp4" 2.2 2.4
enc magnific.mp4    "$A/magnific_video-upscale_3009454435.mp4"                 0.5      3.4
enc greenwide.mp4   "$A/kling_20260527_作品_gerar_uma__2957_0_prob4.mov"        0.0      3.1
enc desk.mp4        "$A/2026-04-24 13-52-20.mp4"                              45.2      2.3
enc smartest.mp4    "$A/latest2br1_SmartestPerson_Standalone-2026-05-12-13-47-09.mp4" 35.1 2.7
enc blazer.mp4     "$A/kling_20260527_作品_animar_as__5514_0_prob4.mov"         0.0      3.1
enc tripod.mp4      "$A/2026-04-24 13-57-01.mp4"                              15.6      3.8
enc keynote-b.mp4   "$A/latest2ar2_bright-keynote-2026-06-15-16-01-50.mp4"    11.3      3.6
if [ -f "$A/Optical Flare.mp4" ]; then
  enc flare.mp4     "$A/Optical Flare.mp4"                                    0.0      4.0
else
  enc flare.mp4     "$A/Flare.mp4"                                            0.0      4.0
fi

# audio — raw sources, remuxed/converted only
AOUT="$(dirname "$0")/../public/audio"
mkdir -p "$AOUT"
[ -f "$AOUT/bed.m4a" ]        || ffmpeg -v error -y -i "$A/LightTwist Audio Quente.aac" -c copy "$AOUT/bed.m4a"
[ -f "$AOUT/shine.wav" ]      || cp "$A/shine.wav" "$AOUT/shine.wav"
[ -f "$AOUT/logo-reveal.wav" ]|| cp "$A/Mountain Audio - Logo Reveal.wav" "$AOUT/logo-reveal.wav"
echo "audio done"
