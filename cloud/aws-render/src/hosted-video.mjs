import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function mediaCommand(command, args) {
  try {
    return await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const detail = error?.stderr?.trim() || error?.message || String(error);
    throw new Error(`${command} failed: ${detail}`);
  }
}

async function probeVideo(path) {
  const { stdout } = await mediaCommand(process.env.FD_FFPROBE_PATH || "ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height:format=duration",
    "-of", "json",
    path,
  ]);
  const payload = JSON.parse(stdout);
  const stream = payload.streams?.[0];
  const durationSeconds = Number(payload.format?.duration);
  if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Cloud render did not contain a valid video stream.");
  }
  return {
    codec: String(stream.codec_name || ""),
    width: Number(stream.width),
    height: Number(stream.height),
    durationSeconds,
  };
}

async function assertNotBlank(path, durationSeconds) {
  let stderr = "";
  try {
    ({ stderr } = await mediaCommand(process.env.FD_FFMPEG_PATH || "ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i", path,
      "-vf", "blackdetect=d=0.25:pix_th=0.02",
      "-an",
      "-f", "null",
      "-",
    ]));
  } catch (error) {
    throw new Error(`Cloud render visual validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const intervals = Array.from(stderr.matchAll(/black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g));
  const fullBlank = intervals.some((match) => {
    const start = Number(match[1]);
    const duration = Number(match[3]);
    // Encoders commonly end the final decoded frame one frame interval before the
    // container duration, so leave enough tolerance for short validation renders.
    return start <= 0.1 && duration >= Math.max(0.25, durationSeconds * 0.94);
  });
  if (fullBlank) {
    throw new Error("Cloud render produced blank video frames. The artifact was rejected instead of being published.");
  }
}

export async function normalizeHostedVideo({ bytes, inputFilename, width, height }) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "framediff-hosted-video-"));
  const inputPath = join(temporaryDirectory, inputFilename.replace(/[^a-zA-Z0-9._-]/g, "_"));
  const outputPath = join(temporaryDirectory, "render.mp4");
  try {
    await writeFile(inputPath, bytes);
    await mediaCommand(process.env.FD_FFMPEG_PATH || "ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inputPath,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outputPath,
    ]);
    const probe = await probeVideo(outputPath);
    if (probe.codec !== "h264") throw new Error(`Cloud render MP4 used unexpected video codec ${probe.codec || "unknown"}.`);
    if (probe.width !== width || probe.height !== height) {
      throw new Error(`Cloud render dimensions changed from ${width}x${height} to ${probe.width}x${probe.height}.`);
    }
    await assertNotBlank(outputPath, probe.durationSeconds);
    return {
      filename: "render.mp4",
      contentType: "video/mp4",
      bytes: await readFile(outputPath),
      durationSeconds: probe.durationSeconds,
      codec: probe.codec,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
