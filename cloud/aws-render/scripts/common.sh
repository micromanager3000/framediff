#!/usr/bin/env bash
set -euo pipefail

FD_AWS_PROFILE="${FD_AWS_PROFILE:-ravenflow}"
FD_AWS_REGION="${FD_AWS_REGION:-us-west-2}"
FD_AWS_STACK="${FD_AWS_STACK:-framediff-cloud-render}"
FD_EXPECTED_ACCOUNT_ID="920373001555"
FD_FORBIDDEN_ACCOUNT_ID="730806780703"

aws_fd() {
  aws --profile "$FD_AWS_PROFILE" --region "$FD_AWS_REGION" "$@"
}

guard_account() {
  local account_id
  account_id="$(aws_fd sts get-caller-identity --query Account --output text)"
  if [[ "$account_id" == "$FD_FORBIDDEN_ACCOUNT_ID" ]]; then
    echo "Refusing to operate in forbidden LightTwist AWS account $account_id." >&2
    exit 40
  fi
  if [[ "$account_id" != "$FD_EXPECTED_ACCOUNT_ID" ]]; then
    echo "Refusing unexpected AWS account $account_id; expected FrameDiff target $FD_EXPECTED_ACCOUNT_ID." >&2
    exit 41
  fi
}

stack_output() {
  local key="$1"
  aws_fd cloudformation describe-stacks \
    --stack-name "$FD_AWS_STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue | [0]" \
    --output text
}

repo_root() {
  git rev-parse --show-toplevel
}
