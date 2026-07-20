import { describe, expect, it } from "vitest";
import { createAppendWritableSink } from "./exportSinks";

describe("createAppendWritableSink", () => {
  it("writes append-only chunks in byte-position order", async () => {
    const chunks: number[][] = [];
    let closed = false;
    const writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push([...chunk]);
      },
      close: () => {
        closed = true;
      },
    });
    const sink = createAppendWritableSink(writable);

    await sink.write(new Uint8Array([1, 2]), 0);
    await sink.write(new Uint8Array([3]), 2);
    await sink.close?.();

    expect(chunks).toEqual([[1, 2], [3]]);
    expect(closed).toBe(true);
  });

  it("rejects non-contiguous chunks before corrupting an append stream", async () => {
    const chunks: number[][] = [];
    const sink = createAppendWritableSink(
      new WritableStream<Uint8Array>({
        write: (chunk) => {
          chunks.push([...chunk]);
        },
      }),
    );

    await expect(sink.write(new Uint8Array([1]), 3)).rejects.toThrow(/expected append position 0/);
    await sink.abort?.();
    expect(chunks).toEqual([]);
  });
});
