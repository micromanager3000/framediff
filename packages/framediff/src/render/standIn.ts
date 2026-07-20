// Baked-frame stand-ins: during capture, <video> elements and WebGPU canvases are replaced by
// <img> snapshots so html-to-image serializes the whole composition in correct paint order.
// The stand-in MUST composite exactly like the element it replaces — opacity, mix-blend-mode,
// transform and filter all change how a layer lands (a screened flare without its blend mode
// bakes as an opaque cover). Both captureCompositeFrame and exportVideo go through here.

/** Wait until a stand-in <img> is safe to rasterize. Waits for LOAD always, but only awaits
 *  decode() while visible: hidden documents can park decode promises indefinitely (observed:
 *  a 2MB data-URL decode() that never settles in a never-painted tab), and canvas drawImage
 *  decodes synchronously anyway — decode() here is jank-avoidance, not correctness. */
export async function settleStandIn(img: HTMLImageElement): Promise<void> {
  if (!img.complete) {
    await new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    });
  }
  if (document.visibilityState !== "visible") {
    void img.decode().catch(() => {});
    return;
  }
  await img.decode().catch(() => {});
}

/** Build the <img> stand-in for a captured element and insert it right after it — the same
 *  paint position, so later siblings (grade layers, glass) still see it painting BEFORE. */
export function insertStandIn(
  el: HTMLVideoElement | HTMLCanvasElement,
  host: HTMLElement,
  url: string,
  defaultFit: "cover" | "contain",
): HTMLImageElement {
  const img = document.createElement("img");
  img.src = url;
  const cs = getComputedStyle(el);
  img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:${cs.objectFit || defaultFit};`;
  img.style.opacity = cs.opacity;
  img.style.mixBlendMode = cs.mixBlendMode;
  img.style.transform = cs.transform === "none" ? "" : cs.transform;
  img.style.filter = cs.filter === "none" ? "" : cs.filter;
  if (el.parentElement) el.after(img);
  else host.appendChild(img);
  return img;
}
