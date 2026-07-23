import { describe, expect, it } from "vitest";
import type { GenerativeWorkspaceSnapshot } from "@framediff/studio-model";
import { generatingTakeViews } from "./Generative.ViewModel";

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
