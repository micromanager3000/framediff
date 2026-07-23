# FrameDiff AWS GPU render pilot

This deploys a real NVIDIA L4 worker on AWS Batch. The Batch compute environment uses
`g6.2xlarge`, has `minvCpus: 0`, and therefore scales EC2 compute to zero when no job is queued.
The first job type is a representative FrameDiff capability suite:

- DOM/CSS/SVG capture
- nested compositions
- exact `VideoDecoder` frame capture
- audio mixing and H.264 MP4 export
- WebGPU 3D capture and export
- deterministic WebGPU cloth capture
- repeat-capture SHA-256 parity

The stack is deliberately a pilot, not a multi-tenant sandbox. The image contains trusted
FrameDiff source and synthetic media only.

## Account safety

All scripts default to AWS CLI profile `motbot`, account `920373001555`, region `us-west-2`.
They verify the live STS account before doing anything and explicitly reject account
`730806780703` (LightTwist). Never remove this guard.

The target account initially had a zero on-demand G/VT quota. Quota request
`c40cf9132a514a92b0ce26974a1646bfVGtpz38n` requests 8 vCPUs, enough for one
`g6.2xlarge`. The stack can deploy while that request is pending, but a job remains runnable
until quota is granted.

## Deploy and test

All commands use the AWS CLI through the guarded scripts:

```bash
npm --prefix cloud/aws-render install
cloud/aws-render/scripts/deploy.sh
cloud/aws-render/scripts/build-and-push.sh
job_id="$(cloud/aws-render/scripts/submit-capability.sh | head -n1)"
cloud/aws-render/scripts/watch.sh "$job_id"
```

`build-and-push.sh` refuses dirty changes under `cloud/aws-render` and creates its Docker build
context from `git archive HEAD`. Uncommitted workspace edits and local media are therefore never
published to ECR.

Results are written beneath `s3://<artifact-bucket>/jobs/<job-name>/`:

- `status.json`
- `report.json`
- deterministic PNG probes
- short H.264 capability exports

The bucket expires job artifacts after 30 days. CloudWatch logs expire after 14 days. ECR keeps
the latest 12 images.

## Local preflight

With Chrome and FFmpeg installed:

```bash
npm --prefix cloud/aws-render install
cloud/aws-render/scripts/test-local.sh
```

Local preflight permits a missing NVIDIA device but still requires WebGPU, WebCodecs, exact
video decode, deterministic captures, audio muxing, and MP4 export.

## Cost and scaling behavior

AWS Batch itself has no additional charge. The worker uses on-demand EC2 and the account is
billed only while the instance is running, with EC2's 60-second minimum. `g6.2xlarge` was
`$0.9776/hour` in `us-east-1` when this pilot was created; verify the selected region before
production. S3, ECR, EBS, CloudWatch, and transfer are additional.

Cold startup includes AWS Batch scheduling, EC2 boot, ECS registration, and the first image pull.
Measure `createdAt → startedAt` in the Batch job record. Subsequent jobs can reuse the instance
until Batch scales it back to zero.

## Remove the pilot

The template retains the artifact bucket and ECR repository to prevent accidental data loss.
The guarded destroy script empties those stores and deletes the stack:

```bash
cloud/aws-render/scripts/destroy.sh --yes
```
