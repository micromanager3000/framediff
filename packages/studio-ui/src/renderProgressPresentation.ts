import type { RenderProgressSnapshot } from "@framediff/studio-model";

const cloudPhaseLabels: Partial<Record<RenderProgressSnapshot["phase"], string>> = {
  queued: "AWS queued…",
  starting: "AWS starting…",
  rendering: "AWS rendering…",
  uploading: "publishing artifact…",
};

export interface RenderProgressPresentation {
  text: string;
  title?: string;
  determinate: boolean;
}

/**
 * AWS Batch exposes lifecycle state but not frame-level completion. Treat its
 * coarse 0/1 counter as indeterminate instead of presenting a false 0%. A
 * remote worker can opt back into a real percentage by reporting total > 1.
 */
export function renderProgressPresentation(
  progress: RenderProgressSnapshot | null,
): RenderProgressPresentation {
  if (!progress) return { text: "prepare · 0%", determinate: true };

  const cloudLabel = cloudPhaseLabels[progress.phase];
  const hasMeasuredCloudProgress = progress.total > 1;
  if (cloudLabel && !hasMeasuredCloudProgress) {
    return {
      text: cloudLabel,
      ...(progress.message ? { title: progress.message } : {}),
      determinate: false,
    };
  }

  const percent = Math.round((progress.completed / Math.max(1, progress.total)) * 100);
  return {
    text: `${cloudLabel ? `AWS ${progress.phase}` : progress.phase} · ${percent}%`,
    ...(progress.message ? { title: progress.message } : {}),
    determinate: true,
  };
}
