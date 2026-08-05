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

HTML='<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><main data-fd-composition data-fd-id="main" data-fd-width="320" data-fd-height="180" data-fd-fps="24" data-fd-duration="48"><div class="orb"></div><h1>FrameDiff Cloud</h1><p>CSS + MP4 + visible pixels</p></main></body></html>'
CSS='html,body{margin:0}main{position:relative;overflow:hidden;background-color:#10243a;background-image:url("data:image/svg+xml,%3Csvg viewBox=%270 0 180 180%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.9%27 numOctaves=%272%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27 opacity=%27.12%27/%3E%3C/svg%3E");color:#f7fbff;font-family:Arial,sans-serif}.orb{position:absolute;width:64px;height:64px;border-radius:50%;left:calc(28px + var(--fd-frame) * 3px);top:28px;background:#b8ff5a;box-shadow:0 0 32px #b8ff5aaa}h1{position:absolute;left:24px;bottom:42px;margin:0;font-size:30px;letter-spacing:-.04em}p{position:absolute;left:24px;bottom:18px;margin:0;color:#8fd9ff;font-size:12px}'
SOURCE_SHA="$(printf '%s' "$HTML" | shasum -a 256 | awk '{print $1}')"
SOURCE_BASE64="$(printf '%s' "$HTML" | base64 | tr -d '\n')"
CSS_SHA="$(printf '%s' "$CSS" | shasum -a 256 | awk '{print $1}')"
CSS_BASE64="$(printf '%s' "$CSS" | base64 | tr -d '\n')"
[[ "$SOURCE_SHA" =~ ^[a-f0-9]{64}$ ]] || exit 50
[[ -n "$SOURCE_BASE64" ]] || exit 51
[[ "$CSS_SHA" =~ ^[a-f0-9]{64}$ ]] || exit 52
[[ -n "$CSS_BASE64" ]] || exit 53

jq -n \
  --arg prefix "$PREFIX" \
  --arg sha "sha256:$SOURCE_SHA" \
  --arg content "$SOURCE_BASE64" \
  --arg cssSha "sha256:$CSS_SHA" \
  --arg cssContent "$CSS_BASE64" \
  '{
    version: 1,
    kind: "hosted-render",
    outputPrefix: $prefix,
    renderRequest: {
      compositionKey: "main",
      source: {files: {
        "src/Main.html": {sha256: $sha, contentBase64: $content, executable: false},
        "src/styles.css": {sha256: $cssSha, contentBase64: $cssContent, executable: false}
      }},
      settings: {
        width: 320,
        height: 180,
        from: 0,
        to: 48,
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
