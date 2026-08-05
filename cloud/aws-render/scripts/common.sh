#!/usr/bin/env bash
set -euo pipefail

FD_AWS_PROFILE="${FD_AWS_PROFILE:-framediff-machine}"
FD_AWS_REGION="${FD_AWS_REGION:-us-west-2}"
FD_AWS_STACK="${FD_AWS_STACK:-framediff-cloud-render}"
FD_EXPECTED_ACCOUNT_ID="920373001555"
FD_FORBIDDEN_ACCOUNT_ID="730806780703"

aws_fd() {
  aws --profile "$FD_AWS_PROFILE" --region "$FD_AWS_REGION" "$@"
}

guard_account() {
  local identity account_id identity_arn
  identity="$(aws_fd sts get-caller-identity --output json)"
  account_id="$(jq -r '.Account' <<<"$identity")"
  identity_arn="$(jq -r '.Arn' <<<"$identity")"
  if [[ "$account_id" == "$FD_FORBIDDEN_ACCOUNT_ID" ]]; then
    echo "Refusing to operate in forbidden LightTwist AWS account $account_id." >&2
    exit 40
  fi
  if [[ "$account_id" != "$FD_EXPECTED_ACCOUNT_ID" ]]; then
    echo "Refusing unexpected AWS account $account_id; expected FrameDiff target $FD_EXPECTED_ACCOUNT_ID." >&2
    exit 41
  fi
  if [[ "$identity_arn" != arn:aws:sts::$FD_EXPECTED_ACCOUNT_ID:assumed-role/framediff-cloud-render-machine/* ]]; then
    echo "Refusing non-machine AWS identity $identity_arn for routine FrameDiff work." >&2
    echo "Run scripts/bootstrap-machine-auth.sh with the break-glass ravenflow profile if machine credentials need repair." >&2
    exit 42
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
