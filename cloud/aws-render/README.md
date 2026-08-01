# FrameDiff AWS GPU render and vision pilot

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

The same versioned Batch/S3 job protocol also supports:

- relative monocular depth maps with Depth Anything V2 Small
- ADE20K semantic segmentation with SegFormer B0

Both model revisions and their ONNX weights are pinned into the worker image. Inference therefore
runs inside the FrameDiff AWS worker over hardware WebGPU and does not call a hosted inference API
at job runtime.

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

Depth and segmentation use a built-in synthetic test scene when no image is supplied:

```bash
job_id="$(cloud/aws-render/scripts/submit-depth.sh | head -n1)"
cloud/aws-render/scripts/watch.sh "$job_id"

job_id="$(cloud/aws-render/scripts/submit-segmentation.sh ./input.png | head -n1)"
cloud/aws-render/scripts/watch.sh "$job_id"
```

`watch.sh` prints the report and downloads the full result beneath
`out/aws-render/cloud-<job-id>/`. Image inputs must be JPEG, PNG, or WebP and no larger than
25 MiB. Submitted inputs, specs, and outputs expire after 30 days.

`build-and-push.sh` refuses dirty changes under `cloud/aws-render` and creates its Docker build
context from `git archive HEAD`. Uncommitted workspace edits and local media are therefore never
published to ECR. It resolves the pushed tag to an ECR digest, updates Batch to the digest reference,
and the ECR repository rejects tag mutation.

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

The two inference jobs have matching local preflights:

```bash
node cloud/aws-render/scripts/cache-models.mjs
cloud/aws-render/scripts/test-local.sh depth-map
cloud/aws-render/scripts/test-local.sh segmentation
```

## Cost and scaling behavior

AWS Batch itself has no additional charge. The worker uses on-demand EC2 and the account is
billed only while the instance is running, with EC2's 60-second minimum. The AWS Price List API
returned `$0.9776/hour` for Linux `g6.2xlarge` in `us-west-2` when this pilot was created.
S3, ECR, EBS, public IPv4, CloudWatch, and transfer are additional.

At that rate, useful warm compute ranges from roughly `$0.002–$0.005` for a simple 10-second
render to `$0.98–$2.44` for a heavy 10-minute render, before startup and scale-down overhead.
See `docs/super-fast-cloud-render-plan.html` for the length/complexity matrix and cold-lifecycle
planning cases.

Cold startup includes AWS Batch scheduling, EC2 boot, ECS registration, and the first image pull.
Measure `createdAt → startedAt` in the Batch job record. Subsequent jobs can reuse the instance
until Batch scales it back to zero.

## Remove the pilot

The template retains the artifact bucket and ECR repository to prevent accidental data loss.
The guarded destroy script empties those stores and deletes the stack:

```bash
cloud/aws-render/scripts/destroy.sh --yes
```
