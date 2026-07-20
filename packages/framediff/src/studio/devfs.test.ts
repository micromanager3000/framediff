import { describe, expect, it } from "vitest";
import { latestFailedGenJob, type GenJob } from "./devfs";

const job = (id: string, status: GenJob["status"]): GenJob => ({
  id,
  gen: "shot",
  endpoint: "provider/model",
  recipeHash: "sha256:recipe",
  status,
  at: `2026-07-0${id}T00:00:00.000Z`,
});

describe("latestFailedGenJob", () => {
  it("hides an old failure after a newer take succeeds", () => {
    expect(latestFailedGenJob([job("1", "failed"), job("2", "done")])).toBeNull();
  });

  it("returns the failure when the newest attempt itself failed", () => {
    expect(latestFailedGenJob([job("1", "done"), job("2", "failed")])?.id).toBe("2");
  });
});
