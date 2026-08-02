import { describe, expect, it } from "vitest";
import type { GenerativeWorkspaceSnapshot } from "@framediff/studio-model";
import {
  failedTakeViews,
  generatingTakeViews,
  historicalTakeViews,
  normalizePreviewSelection,
  nextGenerationTake,
  readableGenerationError,
  referenceKindForMime,
} from "./Generative.ViewModel";

const workspace = {
  takes: [],
  jobs: [],
} as unknown as GenerativeWorkspaceSnapshot;

describe("referenceKindForMime", () => {
  it("infers reference kinds from imported media MIME types", () => {
    expect(referenceKindForMime("image/png")).toBe("image");
    expect(referenceKindForMime("video/quicktime")).toBe("video");
    expect(referenceKindForMime("audio/wav")).toBe("audio");
    expect(referenceKindForMime("application/octet-stream")).toBeNull();
  });
});

describe("generatingTakeViews", () => {
  it("keeps server numbering authoritative for in-flight attempts", () => {
    expect(generatingTakeViews({
      ...workspace,
      takes: [{ take: 2 }],
      jobs: [
        { id: "queued-job", status: "queued" },
        { id: "running-job", status: "running", take: 7 },
        { id: "old-job", status: "done", take: 1 },
      ],
    } as GenerativeWorkspaceSnapshot)).toEqual([
      { id: "queued-job", take: undefined, status: "queued" },
      { id: "running-job", take: 7, status: "running" },
    ]);
  });

  it("removes the placeholder once the job is no longer active", () => {
    expect(generatingTakeViews({
      ...workspace,
      jobs: [{ id: "finished-job", status: "done", take: 1 }],
    } as GenerativeWorkspaceSnapshot)).toEqual([]);
  });

  it("shows an unnumbered placeholder while the submit request is still opening", () => {
    expect(generatingTakeViews({
      ...workspace,
      takes: [{ take: 4 }],
    } as GenerativeWorkspaceSnapshot, true)).toEqual([
      { id: "submitting", status: "queued" },
    ]);
  });
});

describe("failedTakeViews", () => {
  it("keeps a failed attempt as a numbered historical take", () => {
    expect(failedTakeViews({
      ...workspace,
      liveHash: "sha256:failed",
      takes: [{ take: 2 }],
      jobs: [{
        id: "failed-job",
        status: "failed",
        recipeHash: "sha256:failed",
        error: 'result 422: [{"msg":"The reference cannot be processed.","type":"content_policy_violation"}]',
      }],
    } as GenerativeWorkspaceSnapshot)).toEqual([{
      id: "failed-job",
      take: 3,
      error: "The reference cannot be processed.",
      policyRejection: true,
      matchesCurrentRecipe: true,
    }]);
  });

  it("retains older failures after a newer job succeeds", () => {
    expect(failedTakeViews({
      ...workspace,
      liveHash: "sha256:done",
      jobs: [
        { id: "failed-job", status: "failed", take: 1, recipeHash: "sha256:failed", error: "failed" },
        { id: "done-job", status: "done", take: 2, recipeHash: "sha256:done" },
      ],
    } as GenerativeWorkspaceSnapshot)).toEqual([{
      id: "failed-job",
      take: 1,
      error: "failed",
      policyRejection: false,
      matchesCurrentRecipe: false,
    }]);
  });

  it("extracts a readable message from a truncated provider payload", () => {
    expect(readableGenerationError(
      'result 422: [{"loc":["body"],"msg":"A clear provider message.","ctx":{"reason":"truncated',
    )).toBe("A clear provider message.");
  });
});

describe("historicalTakeViews", () => {
  it("interleaves failed and generated attempts in descending take order", () => {
    const generatedTake = {
      take: 2,
      assetId: "take-2",
      contentHash: "sha256:take-2",
      bytes: 400_000,
      recipeHash: "sha256:done",
      endpoint: "provider/model",
      outputKind: "audio",
    } as const;
    const failedTake = {
      id: "failed-job",
      take: 1,
      error: "Voice not found",
      policyRejection: false,
      matchesCurrentRecipe: false,
    };

    expect(historicalTakeViews({
      ...workspace,
      takes: [generatedTake],
    } as GenerativeWorkspaceSnapshot, [failedTake])).toEqual([
      { kind: "generated", take: 2, generatedTake },
      { kind: "failed", take: 1, failedTake },
    ]);
  });
});

describe("normalizePreviewSelection", () => {
  it("falls back to the draft when a selected take is no longer available", () => {
    expect(normalizePreviewSelection({ kind: "take", take: 8 }, { ...workspace, takes: [] } as GenerativeWorkspaceSnapshot)).toEqual({ kind: "draft" });
    expect(normalizePreviewSelection({ kind: "draft" }, { ...workspace, takes: [] } as GenerativeWorkspaceSnapshot)).toEqual({ kind: "draft" });
  });
});

describe("nextGenerationTake", () => {
  it("numbers drafts after both successful and failed attempts", () => {
    expect(nextGenerationTake({
      ...workspace,
      takes: [{ take: 2 }],
      jobs: [{ id: "failed-job", status: "failed", take: 4 }],
    } as GenerativeWorkspaceSnapshot)).toBe(5);
  });
});
