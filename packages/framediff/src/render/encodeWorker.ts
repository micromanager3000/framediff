// Encode worker. Receives a fully-composited frame bitmap (DOM + baked video, at the output
// resolution) and the mixed audio PCM; encodes video with WebCodecs, audio to AAC, and muxes
// to MP4 — off the main thread. Messages are processed strictly in order via an async queue.

import { Muxer, ArrayBufferTarget, StreamTarget } from "mp4-muxer";
import { zeroMp4Timestamps } from "./mp4Timestamps";

const ctx = self as unknown as Worker;
const STREAM_BACKPRESSURE_BYTES = 32 * 1024 * 1024;

interface InitMsg {
  type: "init";
  width: number;
  height: number;
  fps: number;
  codec: string;
  muxerCodec: "avc" | "av1";
  bitrate: number;
  hardwareAcceleration?: "no-preference" | "prefer-hardware" | "prefer-software";
  audio: { sampleRate: number; numberOfChannels: number } | null;
  output?: { mode: "buffer" } | { mode: "stream"; fastStart?: false | "fragmented" };
}
interface FrameMsg { type: "frame"; n: number; bitmap: ImageBitmap }
interface AudioMsg { type: "audio"; channels: ArrayBuffer[]; length: number; sampleRate: number }
interface FinishMsg { type: "finish" }
interface StreamAckMsg { type: "stream-ack"; id: number; ok: boolean; message?: string }
type InMsg = InitMsg | FrameMsg | AudioMsg | FinishMsg;

let muxer: Muxer<ArrayBufferTarget | StreamTarget> | null = null;
let bufferTarget: ArrayBufferTarget | null = null;
let vEncoder: VideoEncoder | null = null;
let aEncoder: AudioEncoder | null = null;
let canvas: OffscreenCanvas | null = null;
let c2d: OffscreenCanvasRenderingContext2D | null = null;
let W = 0;
let H = 0;
let FPS = 30;

let streamMode = false;
let nextStreamChunkId = 0;
let pendingStreamBytes = 0;
let streamBytesWritten = 0;
let streamError: Error | null = null;
let streamAckPromises: Promise<void>[] = [];
let streamWaiters: (() => void)[] = [];
const streamAcks = new Map<number, { byteLength: number; resolve: () => void; reject: (err: Error) => void }>();

const sleep = () => new Promise((r) => setTimeout(r, 0));

function resetStreamState() {
  streamMode = false;
  nextStreamChunkId = 0;
  pendingStreamBytes = 0;
  streamBytesWritten = 0;
  streamError = null;
  streamAckPromises = [];
  streamWaiters = [];
  streamAcks.clear();
}

function wakeStreamWaiters() {
  const waiters = streamWaiters;
  streamWaiters = [];
  waiters.forEach((w) => w());
}

function postStreamChunk(raw: Uint8Array, position: number) {
  const data = raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength ? raw : raw.slice();
  zeroMp4Timestamps(data);

  const id = nextStreamChunkId++;
  pendingStreamBytes += data.byteLength;
  streamBytesWritten = Math.max(streamBytesWritten, position + data.byteLength);

  const ack = new Promise<void>((resolve, reject) => {
    streamAcks.set(id, { byteLength: data.byteLength, resolve, reject });
  });
  streamAckPromises.push(ack);
  ctx.postMessage({ type: "chunk", id, position, data }, [data.buffer]);
}

function handleStreamAck(msg: StreamAckMsg) {
  const ack = streamAcks.get(msg.id);
  if (!ack) return;
  streamAcks.delete(msg.id);
  pendingStreamBytes = Math.max(0, pendingStreamBytes - ack.byteLength);
  if (msg.ok) {
    ack.resolve();
  } else {
    const err = new Error(msg.message || "streamed MP4 chunk write failed");
    streamError = streamError ?? err;
    ack.reject(err);
  }
  wakeStreamWaiters();
}

async function waitForStreamBackpressure() {
  while (streamMode && pendingStreamBytes > STREAM_BACKPRESSURE_BYTES) {
    if (streamError) throw streamError;
    await new Promise<void>((resolve) => streamWaiters.push(resolve));
  }
  if (streamError) throw streamError;
}

async function waitForStreamAcks() {
  if (!streamMode) return;
  await Promise.all(streamAckPromises);
  if (streamError) throw streamError;
}

async function encodeAudioPCM(ch0: Float32Array, ch1: Float32Array, sampleRate: number) {
  const total = ch0.length;
  const CHUNK = 4096;
  for (let i = 0; i < total; i += CHUNK) {
    const n = Math.min(CHUNK, total - i);
    const data = new Float32Array(n * 2); // f32-planar: [ch0..., ch1...]
    data.set(ch0.subarray(i, i + n), 0);
    data.set(ch1.subarray(i, i + n), n);
    const ad = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((i / sampleRate) * 1_000_000),
      data,
    });
    aEncoder!.encode(ad);
    ad.close();
    while (aEncoder!.encodeQueueSize > 12) {
      await sleep();
      await waitForStreamBackpressure();
    }
  }
}

async function handle(msg: InMsg) {
  if (msg.type === "init") {
    resetStreamState();
    W = msg.width;
    H = msg.height;
    FPS = msg.fps;
    canvas = new OffscreenCanvas(W, H);
    c2d = canvas.getContext("2d");
    const output = msg.output ?? { mode: "buffer" };
    streamMode = output.mode === "stream";
    bufferTarget = output.mode === "buffer" ? new ArrayBufferTarget() : null;
    const target =
      output.mode === "stream"
        ? new StreamTarget({ onData: (data, position) => postStreamChunk(data, position) })
        : bufferTarget!;
    muxer = new Muxer({
      target,
      video: { codec: msg.muxerCodec, width: W, height: H },
      ...(msg.audio ? { audio: { codec: "aac" as const, sampleRate: msg.audio.sampleRate, numberOfChannels: msg.audio.numberOfChannels } } : {}),
      fastStart: output.mode === "stream" ? (output.fastStart ?? false) : "in-memory",
    });
    vEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer!.addVideoChunk(chunk, meta),
      error: (err) => ctx.postMessage({ type: "error", message: String(err) }),
    });
    vEncoder.configure({
      codec: msg.codec,
      width: W,
      height: H,
      bitrate: msg.bitrate,
      framerate: FPS,
      ...(msg.hardwareAcceleration ? { hardwareAcceleration: msg.hardwareAcceleration } : {}),
    });
    if (msg.audio) {
      aEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer!.addAudioChunk(chunk, meta),
        error: (err) => ctx.postMessage({ type: "error", message: String(err) }),
      });
      aEncoder.configure({ codec: "mp4a.40.2", sampleRate: msg.audio.sampleRate, numberOfChannels: msg.audio.numberOfChannels, bitrate: 192_000 });
    }
    ctx.postMessage({ type: "ready" });
  } else if (msg.type === "frame") {
    const g = c2d!;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#000000";
    g.fillRect(0, 0, W, H);
    g.drawImage(msg.bitmap, 0, 0, W, H);
    msg.bitmap.close();

    const frame = new VideoFrame(canvas!, {
      timestamp: Math.round((msg.n * 1_000_000) / FPS),
      duration: Math.round(1_000_000 / FPS),
    });
    vEncoder!.encode(frame, { keyFrame: msg.n % FPS === 0 });
    frame.close();
    while (vEncoder!.encodeQueueSize > 6) {
      await sleep();
      await waitForStreamBackpressure();
    }
    await waitForStreamBackpressure();
    ctx.postMessage({ type: "encoded", n: msg.n });
  } else if (msg.type === "audio") {
    if (aEncoder) {
      await encodeAudioPCM(new Float32Array(msg.channels[0]), new Float32Array(msg.channels[1]), msg.sampleRate);
    }
  } else if (msg.type === "finish") {
    await vEncoder!.flush();
    if (aEncoder) await aEncoder.flush();
    muxer!.finalize();
    if (streamMode) {
      await waitForStreamAcks();
      ctx.postMessage({ type: "done", bytesWritten: streamBytesWritten });
    } else {
      const out = bufferTarget!.buffer;
      zeroMp4Timestamps(out); // make the container byte-deterministic
      ctx.postMessage({ type: "done", buffer: out }, [out]);
    }
  }
}

// process messages strictly in order
const queue: InMsg[] = [];
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const msg = queue.shift()!;
    try {
      await handle(msg);
    } catch (err) {
      ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
  pumping = false;
}

ctx.addEventListener("message", (e: MessageEvent<InMsg | StreamAckMsg>) => {
  const data = e.data;
  if (data.type === "stream-ack") {
    handleStreamAck(data);
    return;
  }
  queue.push(data);
  void pump();
});
