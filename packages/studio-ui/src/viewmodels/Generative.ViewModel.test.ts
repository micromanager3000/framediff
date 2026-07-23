import { describe, expect, it } from "vitest";
import type { GenerativeWorkspaceSnapshot } from "@framediff/studio-model";
import { failedTakeView, generatingTakeViews, readableGenerationError } from "./Generative.ViewModel";

const workspace = {
  takes: [],
  jobs: [],
} as unknown as GenerativeWorkspaceSnapshot;

describe("generatingTakeViews", () => {
  it("turns queued and running jobs into numbered in-flight takes", () => {
    expect(generatingTakeViews({
      ...workspace,
      takes: [{ take: 2 }],
      jobs: [
        { id: "queued-job", status: "queued" },
        { id: "running-job", status: "running", take: 7 },
        { id: "old-job", status: "done", take: 1 },
      ],
    } as GenerativeWorkspaceSnapshot)).toEqual([
      { id: "queued-job", take: 3, status: "queued" },
      { id: "running-job", take: 7, status: "running" },
    ]);
  });

  it("removes the placeholder once the job is no longer active", () => {
    expect(generatingTakeViews({
      ...workspace,
      jobs: [{ id: "finished-job", status: "done", take: 1 }],
    } as GenerativeWorkspaceSnapshot)).toEqual([]);
  });

  it("shows an optimistic generating take while the submit request is still opening", () => {
    expect(generatingTakeViews({
      ...workspace,
      takes: [{ take: 4 }],
    } as GenerativeWorkspaceSnapshot, true)).toEqual([
      { id: "submitting", take: 5, status: "queued" },
    ]);
  });
});

describe("failedTakeView", () => {
  it("shows the newest failed attempt as the next take", () => {
    expect(failedTakeView({
      ...workspace,
      takes: [{ take: 2 }],
      jobs: [{
        id: "failed-job",
        status: "failed",
        error: 'result 422: [{"msg":"The reference cannot be processed.","type":"content_policy_violation"}]',
      }],
    } as GenerativeWorkspaceSnapshot)).toEqual({
      id: "failed-job",
      take: 3,
      error: "The reference cannot be processed.",
      policyRejection: true,
    });
  });

  it("hides an older failure after a newer job succeeds", () => {
    expect(failedTakeView({
      ...workspace,
      jobs: [
        { id: "failed-job", status: "failed", error: "failed" },
        { id: "done-job", status: "done", take: 1 },
      ],
    } as GenerativeWorkspaceSnapshot)).toBeNull();
  });

  it("extracts a readable message from a truncated provider payload", () => {
    expect(readableGenerationError(
      'result 422: [{"loc":["body"],"msg":"A clear provider message.","ctx":{"reason":"truncated',
    )).toBe("A clear provider message.");
  });
});
