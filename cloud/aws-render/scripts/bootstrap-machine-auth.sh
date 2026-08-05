#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
BOOTSTRAP_PROFILE="${FD_BOOTSTRAP_AWS_PROFILE:-ravenflow}"
MACHINE_PROFILE="${FD_MACHINE_AWS_PROFILE:-framediff-machine}"
REGION="${FD_AWS_REGION:-us-west-2}"
ACCOUNT_ID="920373001555"
AUTH_STACK="framediff-cloud-auth"
AUTH_DIR="${FD_MACHINE_AUTH_DIR:-${HOME:?}/.config/framediff/aws}"
HELPER_VERSION="1.8.4"
CERTIFICATE_CN="FrameDiffDedicatedHost"

mkdir -p "$AUTH_DIR/bin"
chmod 700 "$AUTH_DIR" "$AUTH_DIR/bin"

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)
    HELPER_URL="https://rolesanywhere.amazonaws.com/releases/$HELPER_VERSION/Aarch64/MacOS/Sonoma/aws_signing_helper"
    HELPER_SHA256="a10c8967e632aac61937adb93bc72480402fe8224e836eaa8fb5b2fb30094f5f"
    ;;
  Darwin/x86_64)
    HELPER_URL="https://rolesanywhere.amazonaws.com/releases/$HELPER_VERSION/X86_64/MacOS/Sonoma/aws_signing_helper"
    HELPER_SHA256="99eda17864b93e2f2e32d404ee0aba340502853a49ba263b9e7fac13b3b6abe6"
    ;;
  *)
    echo "Unsupported dedicated-host platform: $(uname -s)/$(uname -m)." >&2
    exit 60
    ;;
esac

HELPER="$AUTH_DIR/bin/aws_signing_helper"
if [[ ! -x "$HELPER" ]] || ! printf '%s  %s\n' "$HELPER_SHA256" "$HELPER" | shasum -a 256 -c -s; then
  TEMP_DIR="$(mktemp -d)"
  cleanup() { rm -rf "${TEMP_DIR:?}"; }
  trap cleanup EXIT
  curl --fail --silent --show-error --location "$HELPER_URL" --output "$TEMP_DIR/aws_signing_helper"
  printf '%s  %s\n' "$HELPER_SHA256" "$TEMP_DIR/aws_signing_helper" | shasum -a 256 -c -s
  install -m 0755 "$TEMP_DIR/aws_signing_helper" "$HELPER"
fi

CA_KEY="$AUTH_DIR/ca-key.pem"
CA_CERT="$AUTH_DIR/ca-certificate.pem"
CLIENT_KEY="$AUTH_DIR/client-key.pem"
CLIENT_CERT="$AUTH_DIR/client-certificate.pem"
CLIENT_CSR="$AUTH_DIR/client.csr"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then
  if [[ -e "$CA_KEY" || -e "$CA_CERT" ]]; then
    echo "Incomplete machine CA state in $AUTH_DIR; refusing to replace it." >&2
    exit 61
  fi
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$CA_KEY"
  openssl req -x509 -new -sha256 -key "$CA_KEY" -days 3650 \
    -subj "/CN=FrameDiffDedicatedHostCA/O=FrameDiff" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$CA_CERT"
  chmod 600 "$CA_KEY" "$CA_CERT"
fi

if [[ ! -f "$CLIENT_KEY" ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$CLIENT_KEY"
  chmod 600 "$CLIENT_KEY"
fi
if [[ ! -f "$CLIENT_CERT" ]] || ! openssl x509 -checkend 2592000 -noout -in "$CLIENT_CERT"; then
  openssl req -new -sha256 -key "$CLIENT_KEY" -subj "/CN=$CERTIFICATE_CN/O=FrameDiff" -out "$CLIENT_CSR"
  openssl x509 -req -sha256 -in "$CLIENT_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" \
    -CAcreateserial -days 825 \
    -extfile <(printf '%s\n' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature' 'extendedKeyUsage=clientAuth') \
    -out "$CLIENT_CERT"
  chmod 600 "$CLIENT_CERT"
fi

if [[ "${FD_MACHINE_CERTIFICATE_ONLY:-0}" == "1" ]]; then
  echo "Machine certificate is valid for at least 30 days; no AWS login was used." >&2
  exit 0
fi

CALLER_ACCOUNT="$(aws --profile "$BOOTSTRAP_PROFILE" --region "$REGION" sts get-caller-identity --query Account --output text)"
if [[ "$CALLER_ACCOUNT" != "$ACCOUNT_ID" ]]; then
  echo "Refusing bootstrap in account $CALLER_ACCOUNT; expected $ACCOUNT_ID." >&2
  exit 62
fi

CA_BODY="$(<"$CA_CERT")"
aws --profile "$BOOTSTRAP_PROFILE" --region "$REGION" cloudformation validate-template \
  --template-body "file://$ROOT/cloud/aws-render/auth-template.yaml" >/dev/null
aws --profile "$BOOTSTRAP_PROFILE" --region "$REGION" cloudformation deploy \
  --stack-name "$AUTH_STACK" \
  --template-file "$ROOT/cloud/aws-render/auth-template.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    "TrustAnchorCertificateBody=$CA_BODY" \
    "MachineSubjectCommonName=$CERTIFICATE_CN" \
  --tags Project=FrameDiff ManagedBy=cloudformation \
  --no-fail-on-empty-changeset

ROLE_ARN="$(aws --profile "$BOOTSTRAP_PROFILE" --region "$REGION" cloudformation describe-stacks \
  --stack-name "$AUTH_STACK" --query 'Stacks[0].Outputs[?OutputKey==`MachineRoleArn`].OutputValue | [0]' --output text)"
PROFILE_ARN="$(aws --profile "$BOOTSTRAP_PROFILE" --region "$REGION" cloudformation describe-stacks \
  --stack-name "$AUTH_STACK" --query 'Stacks[0].Outputs[?OutputKey==`MachineProfileArn`].OutputValue | [0]' --output text)"
TRUST_ANCHOR_ARN="$(aws --profile "$BOOTSTRAP_PROFILE" --region "$REGION" cloudformation describe-stacks \
  --stack-name "$AUTH_STACK" --query 'Stacks[0].Outputs[?OutputKey==`MachineTrustAnchorArn`].OutputValue | [0]' --output text)"
for arn in "$ROLE_ARN" "$PROFILE_ARN" "$TRUST_ANCHOR_ARN"; do
  if [[ ! "$arn" =~ ^arn:aws: ]]; then
    echo "The auth stack returned an invalid ARN: $arn" >&2
    exit 63
  fi
done

AUTH_DIR_ABSOLUTE="$(cd "$AUTH_DIR" && pwd -P)"
CREDENTIAL_PROCESS="$AUTH_DIR_ABSOLUTE/bin/aws_signing_helper credential-process --certificate $AUTH_DIR_ABSOLUTE/client-certificate.pem --private-key $AUTH_DIR_ABSOLUTE/client-key.pem --trust-anchor-arn $TRUST_ANCHOR_ARN --profile-arn $PROFILE_ARN --role-arn $ROLE_ARN --region $REGION --session-duration 3600"
aws configure set credential_process "$CREDENTIAL_PROCESS" --profile "$MACHINE_PROFILE"
aws configure set region "$REGION" --profile "$MACHINE_PROFILE"
aws configure set output json --profile "$MACHINE_PROFILE"
chmod 600 "${AWS_CONFIG_FILE:-${HOME:?}/.aws/config}"

aws --profile "$MACHINE_PROFILE" --region "$REGION" sts get-caller-identity
openssl x509 -in "$CLIENT_CERT" -noout -subject -issuer -dates -fingerprint -sha256
echo "Configured renewable FrameDiff credentials in profile $MACHINE_PROFILE." >&2
echo "The interactive $BOOTSTRAP_PROFILE profile remains available only for auth-stack recovery." >&2
