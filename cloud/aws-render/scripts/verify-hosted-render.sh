#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
guard_account

JOB_ID="$("$SCRIPT_DIR/submit-hosted-smoke.sh")"
if [[ ! "$JOB_ID" =~ ^[a-f0-9-]{36}$ ]]; then
  echo "Hosted render canary returned an invalid AWS Batch job id: $JOB_ID" >&2
  exit 70
fi
OUTPUT_DIR="${FD_DOWNLOAD_DIR:-$(repo_root)/out/aws-render/deploy-canary-$JOB_ID}"
FD_DOWNLOAD_DIR="$OUTPUT_DIR" "$SCRIPT_DIR/watch.sh" "$JOB_ID"

REPORT="$OUTPUT_DIR/report.json"
VIDEO="$OUTPUT_DIR/artifacts/render.mp4"
[[ -s "$REPORT" ]] || { echo "Canary report is missing: $REPORT" >&2; exit 71; }
[[ -s "$VIDEO" ]] || { echo "Canary MP4 is missing: $VIDEO" >&2; exit 72; }

jq -e '
  .kind == "hosted-render"
  and .result.filename == "render.mp4"
  and .result.contentType == "video/mp4"
  and .result.codec == "h264"
  and .result.width == 320
  and .result.height == 180
  and (.worker.browserErrors | length) == 0
' "$REPORT" >/dev/null || { echo "Canary report contract failed." >&2; exit 73; }

PROBE="$(ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,nb_frames:format=duration -of json "$VIDEO")"
jq -e '
  .streams[0].codec_name == "h264"
  and .streams[0].width == 320
  and .streams[0].height == 180
  and .streams[0].pix_fmt == "yuv420p"
  and (.streams[0].nb_frames | tonumber) == 48
  and (.format.duration | tonumber) >= 1.99
  and (.format.duration | tonumber) <= 2.01
' <<<"$PROBE" >/dev/null || { echo "Independent MP4 probe failed." >&2; exit 74; }

BLACK_OUTPUT="$(ffmpeg -hide_banner -nostats -i "$VIDEO" -vf 'blackdetect=d=0.25:pix_th=0.10' -an -f null - 2>&1)"
if rg -q 'black_(start|end|duration)' <<<"$BLACK_OUTPUT"; then
  echo "Canary contains a black segment." >&2
  exit 75
fi

Y_AVERAGE="$(ffmpeg -hide_banner -loglevel error -i "$VIDEO" \
  -vf 'select=eq(n\,0),signalstats,metadata=print:file=-' -frames:v 1 -f null - 2>/dev/null \
  | awk -F= '/lavfi.signalstats.YAVG/ {print $2; exit}')"
if [[ ! "$Y_AVERAGE" =~ ^[0-9]+([.][0-9]+)?$ ]] || ! awk -v y="$Y_AVERAGE" 'BEGIN { exit !(y > 15 && y < 120) }'; then
  echo "Canary first-frame luminance is outside the styled-scene range: ${Y_AVERAGE:-missing}." >&2
  exit 76
fi

UNIQUE_FRAME_HASHES="$(ffmpeg -hide_banner -loglevel error -i "$VIDEO" \
  -vf 'select=eq(n\,0)+eq(n\,47)' -vsync vfr -f framemd5 - 2>/dev/null \
  | awk -F', ' '!/^#/ {print $NF}' | sort -u | wc -l | tr -d ' ')"
if [[ "$UNIQUE_FRAME_HASHES" != "2" ]]; then
  echo "Canary motion check failed; first and last sampled frames are not distinct." >&2
  exit 77
fi

echo "Verified hosted render canary $JOB_ID: H.264 MP4, 48 visible styled frames, no black segment." >&2
echo "$VIDEO"
