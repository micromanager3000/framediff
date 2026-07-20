export interface ExportChunkSink {
  write(data: Uint8Array, position: number): Promise<void> | void;
  close?: () => Promise<void> | void;
  abort?: (reason?: unknown) => Promise<void> | void;
}

export function createAppendWritableSink(writable: WritableStream<Uint8Array>): ExportChunkSink {
  const writer = writable.getWriter();
  let expectedPosition = 0;
  let released = false;

  const release = () => {
    if (!released) {
      writer.releaseLock();
      released = true;
    }
  };

  return {
    async write(data, position) {
      if (position !== expectedPosition) {
        throw new Error(`streamed MP4 chunk arrived at ${position}, expected append position ${expectedPosition}`);
      }
      expectedPosition += data.byteLength;
      await writer.write(data);
    },
    async close() {
      if (released) return;
      try {
        await writer.close();
      } finally {
        release();
      }
    },
    async abort(reason) {
      if (released) return;
      try {
        await writer.abort(reason);
      } finally {
        release();
      }
    },
  };
}

export function createFileSystemWritableSink(writable: FileSystemWritableFileStream): ExportChunkSink {
  let closed = false;

  return {
    async write(data, position) {
      if (closed) throw new Error("file stream is already closed");
      await writable.write({ type: "write", data: new Uint8Array(data), position });
    },
    async close() {
      if (closed) return;
      closed = true;
      await writable.close();
    },
    async abort(reason) {
      if (closed) return;
      closed = true;
      await writable.abort(reason);
    },
  };
}
