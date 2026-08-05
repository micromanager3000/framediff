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
DOCKER_AUTH_DIR="$(mktemp -d)"
cleanup() { rm -rf "${BUILD_DIR:?}" "${DOCKER_AUTH_DIR:?}"; }
trap cleanup EXIT

git -C "$ROOT" archive HEAD | tar -x -C "$BUILD_DIR"
ECR_AUTH="$(aws_fd ecr get-authorization-token \
  --query 'authorizationData[0].authorizationToken' \
  --output text)"
if [[ ! "$ECR_AUTH" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  echo "ECR did not return a valid registry authorization token." >&2
  exit 49
fi
DOCKER_CONFIG_ROOT="${DOCKER_CONFIG:-${HOME:?}/.docker}"
DOCKER_CONFIG_SOURCE="$DOCKER_CONFIG_ROOT/config.json"
if [[ -f "$DOCKER_CONFIG_SOURCE" ]]; then
  jq --arg registry "$REGISTRY" --arg auth "$ECR_AUTH" \
    'del(.auths, .credsStore, .credHelpers) | .auths = {($registry): {auth: $auth}}' \
    "$DOCKER_CONFIG_SOURCE" > "$DOCKER_AUTH_DIR/config.json"
else
  jq -n --arg registry "$REGISTRY" --arg auth "$ECR_AUTH" \
    '{auths: {($registry): {auth: $auth}}}' > "$DOCKER_AUTH_DIR/config.json"
fi

DOCKER_CONFIG="$DOCKER_AUTH_DIR" BUILDX_CONFIG="$DOCKER_CONFIG_ROOT/buildx" docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --file "$BUILD_DIR/cloud/aws-render/Dockerfile" \
  --build-arg "FRAMEDIFF_REVISION=$REVISION" \
  --tag "$REPOSITORY_URI:$IMAGE_TAG" \
  --push \
  "$BUILD_DIR"

IMAGE_DIGEST="$(aws_fd ecr describe-images \
  --repository-name "${REPOSITORY_URI#*/}" \
  --image-ids "imageTag=$IMAGE_TAG" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"
if [[ ! "$IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "ECR did not return an immutable digest for $REPOSITORY_URI:$IMAGE_TAG." >&2
  exit 46
fi

"$SCRIPT_DIR/deploy.sh" "$IMAGE_TAG" "$IMAGE_DIGEST"
echo "$REPOSITORY_URI@$IMAGE_DIGEST"
