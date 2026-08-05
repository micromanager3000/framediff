#!/usr/bin/env bash
set -euo pipefail

MANIFEST="${1:?hosted render.yaml path is required}"
EXPECTED_JOB_DEFINITION="${2:?job definition ARN is required}"
EXPECTED_DIGEST="${3:?worker image digest is required}"
EXPECTED_REVISION="${4:?worker revision is required}"

manifest_value() {
  local key="$1"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*- key: " key "[[:space:]]*$" { found = 1; next }
    found && $0 ~ "^[[:space:]]*- key:" { exit }
    found && $0 ~ "^[[:space:]]*value:" {
      sub("^[[:space:]]*value:[[:space:]]*", "")
      gsub(/^"|"$/, "")
      print
      exit
    }
  ' "$MANIFEST"
}

assert_value() {
  local key="$1" expected="$2" actual
  actual="$(manifest_value "$key")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Hosted render config is stale: $key is ${actual:-missing}; expected $expected." >&2
    exit 78
  fi
}

[[ -f "$MANIFEST" ]] || { echo "Hosted render manifest is missing: $MANIFEST" >&2; exit 79; }
assert_value FRAMEDIFF_AWS_BATCH_JOB_DEFINITION_ARN "$EXPECTED_JOB_DEFINITION"
assert_value FRAMEDIFF_RENDER_WORKER_IMAGE_DIGEST "$EXPECTED_DIGEST"
assert_value FRAMEDIFF_RENDER_FRAMEDIFF_REVISION "$EXPECTED_REVISION"
echo "Verified hosted control-plane config matches $EXPECTED_JOB_DEFINITION / $EXPECTED_DIGEST."
