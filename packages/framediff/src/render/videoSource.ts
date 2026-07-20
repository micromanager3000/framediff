/**
 * Resolve the URL used for deterministic frame decode. A generative composition can deliberately
 * keep a source-less video mounted behind its placeholder slate; that element paints nothing and
 * must not turn exact capture/export into an empty-URL decode failure.
 */
export function videoFrameSource(element: Pick<HTMLVideoElement, "getAttribute" | "currentSrc" | "dataset">): string {
  return element.getAttribute("src")?.trim()
    || element.currentSrc?.trim()
    || element.dataset.fdSrc?.trim()
    || "";
}
