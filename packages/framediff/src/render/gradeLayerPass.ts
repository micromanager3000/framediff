// Pre-compose floating <GradeLayer>s for export. html-to-image's foreignObject rasterization
// cannot sample a backdrop, so a grade layer's backdrop-filter would silently vanish from bakes.
// For each `[data-framediff-gradelayer]` element (document order — later layers see earlier layers'
// baked output): rasterize everything that paints BEFORE it, apply the element's own computed
// backdrop-filter string via canvas 2d (identical filter semantics → preview/export parity by
// construction), and inject the result as a full-frame <img> stand-in under the layer's children
// (the vignette overlay keeps painting above it, as in preview). The layer's CSS backdrop-filter
// is suppressed for the final capture; the returned cleanup restores everything.
//
// Paint order is taken as document order — true for framediff comps (absolutely positioned
// siblings, no z-index games). The vignette overlay needs no special handling: it's a plain
// gradient background and rasterizes as-is.

import { toCanvas } from "../vendor/html-to-image";
import { settleStandIn } from "./standIn";
import { isVisualElementActive } from "./activeElement";

export interface GradeLayerBakeOptions {
  pixelRatio: number;
  fontEmbedCSS: string;
  /** The caller's standard exclusions (raw <video>, WebGPU canvases) — stand-ins must already be in place. */
  baseFilter: (node: Node) => boolean;
}

type BF = CSSStyleDeclaration & { webkitBackdropFilter?: string };

function backdropFilterOf(el: HTMLElement): string {
  const s = getComputedStyle(el) as BF;
  const bf = s.backdropFilter && s.backdropFilter !== "none" ? s.backdropFilter : (s.webkitBackdropFilter ?? "");
  return bf === "none" ? "" : bf;
}

/** True when `node` paints before `layer` (or is an ancestor that must survive as a container). */
function paintsUnder(node: Node, layer: HTMLElement): boolean {
  if (!(node instanceof Element)) return true; // text nodes: parent element decides
  if (node === layer || layer.contains(node)) return false; // the layer and its own subtree
  if (node.contains(layer)) return true; // ancestors carry position/backgrounds — keep
  return !!(node.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING);
}

export async function bakeGradeLayers(host: HTMLElement, opts: GradeLayerBakeOptions): Promise<() => void> {
  const layers = Array.from(host.querySelectorAll<HTMLElement>("[data-framediff-gradelayer]")).filter(
    (el) => isVisualElementActive(el, host) && !!backdropFilterOf(el),
  );
  if (!layers.length) return () => {};

  const injected: HTMLImageElement[] = [];
  const restore: { el: HTMLElement; backdropFilter: string; webkit: string }[] = [];
  for (const layer of layers) {
    const bf = backdropFilterOf(layer);
    const below = await toCanvas(host, {
      pixelRatio: opts.pixelRatio,
      fontEmbedCSS: opts.fontEmbedCSS,
      cacheBust: false,
      filter: (node) => opts.baseFilter(node) && paintsUnder(node, layer),
    });
    const graded = document.createElement("canvas");
    graded.width = below.width;
    graded.height = below.height;
    const ctx = graded.getContext("2d")!;
    ctx.filter = bf;
    ctx.drawImage(below, 0, 0);

    const img = document.createElement("img");
    img.src = graded.toDataURL("image/png");
    // full-frame stand-in under the layer's own children (vignette overlay stays on top)
    img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    layer.prepend(img);
    await settleStandIn(img);
    injected.push(img);

    restore.push({
      el: layer,
      backdropFilter: layer.style.backdropFilter,
      webkit: (layer.style as BF).webkitBackdropFilter ?? "",
    });
    layer.style.backdropFilter = "none";
    (layer.style as BF).webkitBackdropFilter = "none";
  }
  return () => {
    injected.forEach((img) => img.remove());
    for (const r of restore) {
      r.el.style.backdropFilter = r.backdropFilter;
      (r.el.style as BF).webkitBackdropFilter = r.webkit;
    }
  };
}
