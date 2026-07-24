#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
guard_account

JOB_ID="${1:?usage: watch.sh <aws-batch-job-id>}"
BUCKET="$(stack_output ArtifactBucketName)"
LOG_GROUP="$(stack_output LogGroupName)"
LAST_STATUS=""
LOG_STREAM=""

while true; do
  JOB_JSON="$(aws_fd batch describe-jobs --jobs "$JOB_ID" --query 'jobs[0]' --output json)"
  STATUS="$(jq -r '.status // "UNKNOWN"' <<<"$JOB_JSON")"
  if [[ "$STATUS" != "$LAST_STATUS" ]]; then
    REASON="$(jq -r '.statusReason // empty' <<<"$JOB_JSON")"
    echo "$(date -u +%FT%TZ) $STATUS ${REASON}"
    LAST_STATUS="$STATUS"
  fi
  if [[ -z "$LOG_STREAM" ]]; then
    LOG_STREAM="$(jq -r '.container.logStreamName // empty' <<<"$JOB_JSON")"
  fi
  case "$STATUS" in
    SUCCEEDED)
      PREFIX="$(jq -r '.tags.OutputPrefix // empty' <<<"$JOB_JSON")"
      if [[ -n "$PREFIX" ]]; then
        OUTPUT_DIR="${FD_DOWNLOAD_DIR:-$(repo_root)/out/aws-render/cloud-$JOB_ID}"
        mkdir -p "$OUTPUT_DIR"
        aws_fd s3 sync "s3://$BUCKET/$PREFIX/" "$OUTPUT_DIR/" --only-show-errors
        cat "$OUTPUT_DIR/report.json"
        echo "Downloaded job results to $OUTPUT_DIR." >&2
      fi
      exit 0
      ;;
    FAILED)
      if [[ -n "$LOG_STREAM" ]]; then
        aws_fd logs get-log-events \
          --log-group-name "$LOG_GROUP" \
          --log-stream-name "$LOG_STREAM" \
          --query 'events[].message' --output text
      fi
      exit 1
      ;;
  esac
  sleep 10
done
