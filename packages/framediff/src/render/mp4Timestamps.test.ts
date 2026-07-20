import { describe, expect, it } from "vitest";
import { zeroMp4Timestamps } from "./mp4Timestamps";

function ascii(type: string) {
  return Uint8Array.from(type.split("").map((c) => c.charCodeAt(0)));
}

function u32(n: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function u64(n: bigint) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n);
  return out;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

function box(type: string, ...payload: Uint8Array[]) {
  const body = concat(...payload);
  return concat(u32(body.byteLength + 8), ascii(type), body);
}

function timeBox(type: "mvhd" | "tkhd" | "mdhd", version: 0 | 1) {
  const flags = new Uint8Array([version, 0, 0, 0]);
  const body =
    version === 1
      ? concat(flags, u64(0x1111111111111111n), u64(0x2222222222222222n), u32(7))
      : concat(flags, u32(0x11111111), u32(0x22222222), u32(7));
  return box(type, body);
}

function findBox(bytes: Uint8Array, type: string, start = 0, end = bytes.byteLength) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let o = start; o + 8 <= end; ) {
    const size = view.getUint32(o);
    const got = String.fromCharCode(view.getUint8(o + 4), view.getUint8(o + 5), view.getUint8(o + 6), view.getUint8(o + 7));
    if (got === type) return { start: o, content: o + 8, end: o + size };
    o += size;
  }
  throw new Error(`box ${type} not found`);
}

describe("zeroMp4Timestamps", () => {
  it("zeros mvhd, tkhd, and mdhd creation/modification times in a full MP4 buffer", () => {
    const bytes = concat(
      box("ftyp", u32(0)),
      box("moov", timeBox("mvhd", 0), box("trak", timeBox("tkhd", 0), box("mdia", timeBox("mdhd", 1)))),
    );
    zeroMp4Timestamps(bytes);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moov = findBox(bytes, "moov");
    const mvhd = findBox(bytes, "mvhd", moov.content, moov.end);
    const trak = findBox(bytes, "trak", moov.content, moov.end);
    const tkhd = findBox(bytes, "tkhd", trak.content, trak.end);
    const mdia = findBox(bytes, "mdia", trak.content, trak.end);
    const mdhd = findBox(bytes, "mdhd", mdia.content, mdia.end);

    expect(view.getUint32(mvhd.content + 4)).toBe(0);
    expect(view.getUint32(mvhd.content + 8)).toBe(0);
    expect(view.getUint32(tkhd.content + 4)).toBe(0);
    expect(view.getUint32(tkhd.content + 8)).toBe(0);
    expect(view.getBigUint64(mdhd.content + 4)).toBe(0n);
    expect(view.getBigUint64(mdhd.content + 12)).toBe(0n);
  });

  it("also works when the chunk starts directly at moov", () => {
    const bytes = box("moov", timeBox("mvhd", 0));
    zeroMp4Timestamps(bytes);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moov = findBox(bytes, "moov");
    const mvhd = findBox(bytes, "mvhd", moov.content, moov.end);
    expect(view.getUint32(mvhd.content + 4)).toBe(0);
    expect(view.getUint32(mvhd.content + 8)).toBe(0);
  });

  it("leaves non-box media chunks alone", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    zeroMp4Timestamps(bytes);
    expect([...bytes]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
