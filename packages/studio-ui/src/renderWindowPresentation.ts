const cloudRenderPhases = new Set(["queued", "starting", "rendering", "uploading"]);

export interface RenderWindowPresentation {
  label: string;
  runningMessage: string;
}

export function renderWindowPresentation(phase: string | undefined): RenderWindowPresentation {
  if (phase && cloudRenderPhases.has(phase)) {
    return {
      label: "CLOUD RENDER MONITOR",
      runningMessage:
        "This job is rendering on AWS. This window only follows server status; closing it will not cancel the cloud render.",
    };
  }
  return {
    label: "DEDICATED RENDERER",
    runningMessage:
      "Keep this window open. It stays separate so Chrome can keep frame capture active in the background.",
  };
}
