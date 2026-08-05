import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { normalizeHostedVideo } from "../src/hosted-video.mjs";

const execFileAsync = promisify(execFile);

async function fixture(filter) {
  const directory = await mkdtemp(join(tmpdir(), "framediff-hosted-video-test-"));
  const path = join(directory, "input.webm");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `${filter}${filter.includes("=") ? ":" : "="}size=160x90:rate=30:duration=1`,
    "-c:v", "libvpx-vp9",
    path,
  ]);
  return { directory, bytes: await readFile(path) };
}

test("normalizes hosted browser video to validated H.264 MP4", async () => {
  const input = await fixture("testsrc2");
  try {
    const output = await normalizeHostedVideo({
      bytes: input.bytes,
      inputFilename: "render.webm",
      width: 160,
      height: 90,
    });
    assert.equal(output.filename, "render.mp4");
    assert.equal(output.contentType, "video/mp4");
    assert.equal(output.codec, "h264");
    assert.ok(output.bytes.byteLength > 1_000);
    assert.ok(output.durationSeconds >= 0.9);
  } finally {
    await rm(input.directory, { recursive: true, force: true });
  }
});

test("rejects a cloud video whose frames are blank", async () => {
  const input = await fixture("color=c=black");
  try {
    await assert.rejects(
      normalizeHostedVideo({
        bytes: input.bytes,
        inputFilename: "render.webm",
        width: 160,
        height: 90,
      }),
      /produced blank video frames/,
    );
  } finally {
    await rm(input.directory, { recursive: true, force: true });
  }
});
