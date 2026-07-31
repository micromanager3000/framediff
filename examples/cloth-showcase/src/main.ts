import { composition } from "./config";

let liveComposition = composition;
if (import.meta.hot) {
  import.meta.hot.accept("./config", (module) => {
    if (module) liveComposition = module.composition;
  });
}

if (import.meta.env.DEV) {
  (window as unknown as { __bake?: unknown }).__bake = async (frame: number, width = 1280, height = 720) => {
    const { captureCompositeFrame } = await import("framediff/render");
    const canvas = await captureCompositeFrame(liveComposition, frame, { width, height });
    return canvas.toDataURL("image/png");
  };
}
