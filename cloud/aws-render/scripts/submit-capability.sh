#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
guard_account

BUCKET="$(stack_output ArtifactBucketName)"
QUEUE="$(stack_output JobQueueArn)"
DEFINITION="$(stack_output JobDefinitionArn)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="framediff-capability-$STAMP"
PREFIX="jobs/$NAME"
SPEC_KEY="specs/$NAME.json"
SPEC_FILE="$(mktemp)"
cleanup() { rm -f "$SPEC_FILE"; }
trap cleanup EXIT

jq -n \
  --arg prefix "$PREFIX" \
  '{version:1,kind:"capability-suite",outputPrefix:$prefix}' > "$SPEC_FILE"
aws_fd s3 cp "$SPEC_FILE" "s3://$BUCKET/$SPEC_KEY" \
  --content-type application/json \
  --sse AES256 >/dev/null

JOB_ID="$(aws_fd batch submit-job \
  --job-name "$NAME" \
  --job-queue "$QUEUE" \
  --job-definition "$DEFINITION" \
  --container-overrides "environment=[{name=FD_JOB_SPEC_S3_KEY,value=$SPEC_KEY}]" \
  --tags Project=FrameDiff JobKind=capability-suite OutputPrefix="$PREFIX" \
  --query jobId --output text)"

echo "$JOB_ID"
echo "Submitted $NAME; results will be written to s3://$BUCKET/$PREFIX/." >&2
