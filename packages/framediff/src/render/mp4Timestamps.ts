// MP4 muxers stamp mvhd/tkhd/mdhd with wall-clock creation/modification times,
// which breaks byte-for-byte deterministic renders. These helpers mutate MP4
// buffers or complete MP4 box chunks in place.

export function zeroMp4Timestamps(target: ArrayBuffer | Uint8Array): void {
  const bytes = target instanceof Uint8Array ? target : new Uint8Array(target);
  if (bytes.byteLength < 8) return;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const typeAt = (o: number) =>
    String.fromCharCode(view.getUint8(o + 4), view.getUint8(o + 5), view.getUint8(o + 6), view.getUint8(o + 7));

  const walk = (start: number, end: number, cb: (type: string, contentStart: number, boxEnd: number) => void) => {
    let o = start;
    while (o + 8 <= end) {
      let size = view.getUint32(o);
      let header = 8;
      if (size === 1) {
        if (o + 16 > end) break;
        size = Number(view.getBigUint64(o + 8));
        header = 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (size < header || o + size > end) break;
      cb(typeAt(o), o + header, o + size);
      o += size;
    }
  };

  const zeroTimes = (contentStart: number) => {
    if (contentStart + 12 > view.byteLength) return;
    const version = view.getUint8(contentStart);
    const p = contentStart + 4;
    if (version === 1) {
      if (p + 16 > view.byteLength) return;
      view.setBigUint64(p, 0n);
      view.setBigUint64(p + 8, 0n);
    } else {
      if (p + 8 > view.byteLength) return;
      view.setUint32(p, 0);
      view.setUint32(p + 4, 0);
    }
  };

  walk(0, bytes.byteLength, (t, cs, ce) => {
    if (t !== "moov") return;
    walk(cs, ce, (t2, cs2, ce2) => {
      if (t2 === "mvhd") zeroTimes(cs2);
      else if (t2 === "trak")
        walk(cs2, ce2, (t3, cs3, ce3) => {
          if (t3 === "tkhd") zeroTimes(cs3);
          else if (t3 === "mdia") walk(cs3, ce3, (t4, cs4) => t4 === "mdhd" && zeroTimes(cs4));
        });
    });
  });
}
