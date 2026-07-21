import { defineConfig } from "vitest/config";

// Unit tests for the pure library logic (graph contracts). Node environment — the hashing uses
// WebCrypto, which is global in Node 18+.
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "examples/hero-lower-third/src/**/*.test.ts",
      "examples/studio-playground/src/**/*.test.ts",
      "examples/cloth-showcase/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
