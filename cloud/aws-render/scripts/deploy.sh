#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
guard_account

ROOT="$(repo_root)"
IMAGE_TAG="${1:-${FD_IMAGE_TAG:-bootstrap}}"
IMAGE_DIGEST="${2:-${FD_IMAGE_DIGEST:-}}"
if [[ ! "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Image tag must start with an alphanumeric character and contain only ECR-safe characters." >&2
  exit 47
fi
if [[ -n "$IMAGE_DIGEST" && ! "$IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "Image digest must be an immutable sha256 digest." >&2
  exit 48
fi
VPC_ID="$(aws_fd ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)"
if [[ -z "$VPC_ID" || "$VPC_ID" == "None" ]]; then
  echo "The target account needs a default VPC in $FD_AWS_REGION for this pilot." >&2
  exit 42
fi

SUBNET_IDS="$(aws_fd ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=map-public-ip-on-launch,Values=true" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
if [[ -z "$SUBNET_IDS" ]]; then
  echo "No public default-VPC subnets found in $FD_AWS_REGION." >&2
  exit 43
fi

aws_fd cloudformation validate-template \
  --template-body "file://$ROOT/cloud/aws-render/template.yaml" >/dev/null

aws_fd cloudformation deploy \
  --stack-name "$FD_AWS_STACK" \
  --template-file "$ROOT/cloud/aws-render/template.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    "ImageTag=$IMAGE_TAG" \
    "ImageDigest=$IMAGE_DIGEST" \
    "InstanceType=g6.2xlarge" \
    "MaxVcpus=8" \
    "VpcId=$VPC_ID" \
    "SubnetIds=$SUBNET_IDS" \
  --tags Project=FrameDiff ManagedBy=cloudformation \
  --no-fail-on-empty-changeset

echo "Deployed $FD_AWS_STACK to account $FD_EXPECTED_ACCOUNT_ID / $FD_AWS_REGION with image ${IMAGE_DIGEST:-$IMAGE_TAG}."
aws_fd cloudformation describe-stacks \
  --stack-name "$FD_AWS_STACK" \
  --query 'Stacks[0].Outputs[].{key:OutputKey,value:OutputValue}' \
  --output table
