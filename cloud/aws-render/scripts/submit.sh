#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
guard_account

JOB_KIND="${1:?usage: submit.sh <capability-suite|depth-map|segmentation> [image]}"
INPUT_FILE="${2:-}"
case "$JOB_KIND" in
  capability-suite)
    if [[ -n "$INPUT_FILE" ]]; then
      echo "capability-suite does not accept an input image." >&2
      exit 46
    fi
    ;;
  depth-map|segmentation)
    if [[ -n "$INPUT_FILE" && ! -f "$INPUT_FILE" ]]; then
      echo "Input image does not exist: $INPUT_FILE" >&2
      exit 47
    fi
    ;;
  *)
    echo "Unsupported job kind: $JOB_KIND" >&2
    exit 48
    ;;
esac

BUCKET="$(stack_output ArtifactBucketName)"
QUEUE="$(stack_output JobQueueArn)"
DEFINITION="$(stack_output JobDefinitionArn)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="framediff-${JOB_KIND//-/_}-$STAMP"
PREFIX="jobs/$NAME"
SPEC_KEY="specs/$NAME.json"
SPEC_FILE="$(mktemp)"
INPUT_KEY=""
INPUT_CONTENT_TYPE=""
cleanup() { rm -f "$SPEC_FILE"; }
trap cleanup EXIT

if [[ -n "$INPUT_FILE" ]]; then
  case "${INPUT_FILE##*.}" in
    jpg|JPG|jpeg|JPEG) INPUT_CONTENT_TYPE="image/jpeg" ;;
    png|PNG) INPUT_CONTENT_TYPE="image/png" ;;
    webp|WEBP) INPUT_CONTENT_TYPE="image/webp" ;;
    *)
      echo "Input must be JPEG, PNG, or WebP: $INPUT_FILE" >&2
      exit 49
      ;;
  esac
  INPUT_KEY="inputs/$NAME/$(basename "$INPUT_FILE")"
  aws_fd s3 cp "$INPUT_FILE" "s3://$BUCKET/$INPUT_KEY" \
    --content-type "$INPUT_CONTENT_TYPE" \
    --sse AES256 >/dev/null
fi

jq -n \
  --arg kind "$JOB_KIND" \
  --arg prefix "$PREFIX" \
  --arg inputKey "$INPUT_KEY" \
  --arg inputType "$INPUT_CONTENT_TYPE" \
  '{
    version: 1,
    kind: $kind,
    outputPrefix: $prefix
  } + if $inputKey == "" then {} else {
    inputS3Key: $inputKey,
    inputContentType: $inputType
  } end' > "$SPEC_FILE"
aws_fd s3 cp "$SPEC_FILE" "s3://$BUCKET/$SPEC_KEY" \
  --content-type application/json \
  --sse AES256 >/dev/null

TAGS="$(jq -cn \
  --arg kind "$JOB_KIND" \
  --arg prefix "$PREFIX" \
  '{Project:"FrameDiff",JobKind:$kind,OutputPrefix:$prefix}')"
JOB_ID="$(aws_fd batch submit-job \
  --job-name "$NAME" \
  --job-queue "$QUEUE" \
  --job-definition "$DEFINITION" \
  --container-overrides "environment=[{name=FD_JOB_SPEC_S3_KEY,value=$SPEC_KEY}]" \
  --tags "$TAGS" \
  --query jobId --output text)"

echo "$JOB_ID"
echo "Submitted $NAME; results will be written to s3://$BUCKET/$PREFIX/." >&2
