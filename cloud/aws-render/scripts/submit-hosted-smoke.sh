#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
guard_account

BUCKET="$(stack_output ArtifactBucketName)"
QUEUE="$(stack_output JobQueueArn)"
DEFINITION="$(stack_output JobDefinitionArn)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="framediff-hosted-render-$STAMP"
PREFIX="jobs/$NAME"
SPEC_KEY="specs/$NAME.json"
SPEC_FILE="$(mktemp)"
cleanup() { rm -f "$SPEC_FILE"; }
trap cleanup EXIT

HTML='<!doctype html><html><head><style>html,body{margin:0}main{position:relative;overflow:hidden;background:linear-gradient(135deg,#08101f,#3d2472);color:white;font-family:Arial,sans-serif}.orb{position:absolute;width:84px;height:84px;border-radius:50%;left:calc(24px + var(--fd-frame) * 9px);top:42px;background:radial-gradient(circle at 30% 25%,#fff,#67e8f9 20%,#8b5cf6 62%);box-shadow:0 0 44px #67e8f999}h1{position:absolute;left:24px;bottom:20px;margin:0;font-size:32px;letter-spacing:-.04em}</style></head><body><main data-fd-composition data-fd-id="main" data-fd-width="320" data-fd-height="180" data-fd-fps="24" data-fd-duration="24"><div class="orb"></div><h1>FrameDiff Cloud</h1></main></body></html>'
SOURCE_SHA="$(printf '%s' "$HTML" | shasum -a 256 | awk '{print $1}')"
SOURCE_BASE64="$(printf '%s' "$HTML" | base64 | tr -d '\n')"
[[ "$SOURCE_SHA" =~ ^[a-f0-9]{64}$ ]] || exit 50
[[ -n "$SOURCE_BASE64" ]] || exit 51

jq -n \
  --arg prefix "$PREFIX" \
  --arg sha "sha256:$SOURCE_SHA" \
  --arg content "$SOURCE_BASE64" \
  '{
    version: 1,
    kind: "hosted-render",
    outputPrefix: $prefix,
    renderRequest: {
      compositionKey: "main",
      source: {files: {"src/Main.html": {sha256: $sha, contentBase64: $content, executable: false}}},
      settings: {
        width: 320,
        height: 180,
        from: 0,
        to: 12,
        outputKind: "video",
        fps: {numerator: 24, denominator: 1},
        bitrate: 1500000
      }
    }
  }' > "$SPEC_FILE"

aws_fd s3 cp "$SPEC_FILE" "s3://$BUCKET/$SPEC_KEY" \
  --content-type application/json \
  --sse AES256 >/dev/null
TAGS="$(jq -cn --arg prefix "$PREFIX" '{Project:"FrameDiff",JobKind:"hosted-render",OutputPrefix:$prefix}')"
JOB_ID="$(aws_fd batch submit-job \
  --job-name "$NAME" \
  --job-queue "$QUEUE" \
  --job-definition "$DEFINITION" \
  --container-overrides "environment=[{name=FD_JOB_SPEC_S3_KEY,value=$SPEC_KEY}]" \
  --tags "$TAGS" \
  --query jobId \
  --output text)"

echo "$JOB_ID"
echo "Submitted $NAME; results will be written to s3://$BUCKET/$PREFIX/." >&2
