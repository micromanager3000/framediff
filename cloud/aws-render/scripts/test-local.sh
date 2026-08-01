#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
FIXTURES="$ROOT/cloud/aws-render/harness/public/fixtures"
JOB_KIND="${1:-capability-suite}"
case "$JOB_KIND" in
  capability-suite|depth-map|segmentation|background-removal) ;;
  *)
    echo "usage: test-local.sh [capability-suite|depth-map|segmentation|background-removal]" >&2
    exit 50
    ;;
esac
mkdir -p "$FIXTURES"

if [[ ! -f "$FIXTURES/synthetic.mp4" ]]; then
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=640x360:rate=30:duration=2" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" \
    -c:v libx264 -pix_fmt yuv420p -preset veryfast -g 30 \
    -c:a aac -b:a 128k -shortest \
    "$FIXTURES/synthetic.mp4"
fi
if [[ ! -f "$FIXTURES/synthetic.wav" ]]; then
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=2" \
    -c:a pcm_s16le \
    "$FIXTURES/synthetic.wav"
fi

FD_WORKSPACE="$ROOT" \
FD_REQUIRE_NVIDIA=0 \
FD_CHROME_PATH="${FD_CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" \
FD_JOB_SPEC_JSON="$(jq -cn --arg kind "$JOB_KIND" '{version:1,kind:$kind,outputPrefix:"local"}')" \
node "$ROOT/cloud/aws-render/src/run-job.mjs"
