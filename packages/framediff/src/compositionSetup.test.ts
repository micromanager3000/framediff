import { describe, expect, it } from "vitest";
import { combineCompositionSetups, type CompositionSetupContext } from "./composition";

describe("combineCompositionSetups", () => {
  it("runs setup in declaration order and cleanup in reverse order", async () => {
    const calls: string[] = [];
    const setup = combineCompositionSetups(
      () => { calls.push("setup-a"); return () => calls.push("cleanup-a"); },
      async () => { calls.push("setup-b"); return () => calls.push("cleanup-b"); },
    );
    const cleanup = await setup({} as CompositionSetupContext);
    expect(calls).toEqual(["setup-a", "setup-b"]);
    cleanup?.();
    expect(calls).toEqual(["setup-a", "setup-b", "cleanup-b", "cleanup-a"]);
  });
});
