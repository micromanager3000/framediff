import { composition } from "./config";

// Keep this side-effect module as an HMR boundary too. studio-runtime accepts config updates,
// but it also imports this file for the audit hook below; without a boundary on both paths,
// Vite propagates composition edits into +page.svelte and remounts the whole Studio shell.
let liveComposition = composition;
if (import.meta.hot) {
  import.meta.hot.accept("./config", (module) => {
    if (module) liveComposition = module.composition;
  });
}

// Dev hook: bake a true export-path composite frame to a JPEG data URL (used for frame-by-frame audits
// against the reference render). Dev-only so it never ships in a production build.
if (import.meta.env.DEV) {
  (window as unknown as { __bake?: unknown }).__bake = async (n: number, w = 960, h = 540, q = 0.85) => {
    const { captureCompositeFrame } = await import("framediff/render");
    const canvas = await captureCompositeFrame(liveComposition, n, { width: w, height: h });
    return canvas.toDataURL("image/jpeg", q);
  };
}
