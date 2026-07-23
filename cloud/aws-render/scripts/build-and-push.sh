#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
guard_account

ROOT="$(repo_root)"
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then rerun this command." >&2
  exit 44
fi
if ! git -C "$ROOT" diff --quiet -- cloud/aws-render; then
  echo "Commit cloud/aws-render before publishing so the image is built from a reproducible Git revision." >&2
  exit 45
fi

REVISION="$(git -C "$ROOT" rev-parse HEAD)"
IMAGE_TAG="${FD_IMAGE_TAG:-${REVISION:0:12}}"
REPOSITORY_URI="$(stack_output RepositoryUri)"
REGISTRY="${REPOSITORY_URI%%/*}"
BUILD_DIR="$(mktemp -d)"
cleanup() { rm -rf "$BUILD_DIR"; }
trap cleanup EXIT

git -C "$ROOT" archive HEAD | tar -x -C "$BUILD_DIR"
aws_fd ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"

docker buildx build \
  --platform linux/amd64 \
  --file "$BUILD_DIR/cloud/aws-render/Dockerfile" \
  --build-arg "FRAMEDIFF_REVISION=$REVISION" \
  --tag "$REPOSITORY_URI:$IMAGE_TAG" \
  --tag "$REPOSITORY_URI:latest" \
  --push \
  "$BUILD_DIR"

"$SCRIPT_DIR/deploy.sh" "$IMAGE_TAG"
echo "$REPOSITORY_URI:$IMAGE_TAG"
