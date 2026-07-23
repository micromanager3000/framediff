#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
guard_account

if [[ "${1:-}" != "--yes" ]]; then
  echo "This deletes the FrameDiff AWS Batch stack and retained ECR/S3 data." >&2
  echo "Rerun as: destroy.sh --yes" >&2
  exit 64
fi

BUCKET="$(stack_output ArtifactBucketName)"
REPOSITORY_URI="$(stack_output RepositoryUri)"
REPOSITORY_NAME="${REPOSITORY_URI#*/}"
aws_fd s3 rm "s3://$BUCKET" --recursive
aws_fd ecr delete-repository --repository-name "$REPOSITORY_NAME" --force >/dev/null
aws_fd cloudformation delete-stack --stack-name "$FD_AWS_STACK"
aws_fd cloudformation wait stack-delete-complete --stack-name "$FD_AWS_STACK"
aws_fd s3api delete-bucket --bucket "$BUCKET"
echo "Deleted FrameDiff cloud render resources from $FD_EXPECTED_ACCOUNT_ID / $FD_AWS_REGION."
