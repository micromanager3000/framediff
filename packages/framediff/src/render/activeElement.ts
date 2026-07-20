/**
 * HTML compositions keep inactive timeline nodes mounted so setup state survives scrubbing. The
 * render pipeline therefore cannot use DOM presence as its activity test (the former component
 * runtime unmounted inactive sequences). These helpers follow the explicit runtime visibility
 * written by `mountComposition` and, for visual layers, authored CSS visibility as well.
 */

function ancestry(element: Element, boundary: HTMLElement): Element[] | null {
  const chain: Element[] = [];
  let containsBoundary = false;
  let current: Element | null = element;
  while (current) {
    chain.push(current);
    if (current === boundary) containsBoundary = true;
    current = current.parentElement;
  }
  // Membership is bounded, but activity is not: a nested composition can be inside a hidden clip
  // owned by an outer composition, and that outer timeline state must gate its effects too.
  return containsBoundary ? chain : null;
}

const isTimelineNode = (element: Element): boolean =>
  element.hasAttribute("data-fd-clip")
  || element.hasAttribute("data-fd-from")
  || element.hasAttribute("data-fd-duration");

/** Whether an element belongs to an active timeline branch. Audio uses this because the audio
 * element itself is normally `display:none` in browser UA styles even while it should be mixed. */
export function isTimelineElementActive(element: Element, boundary: HTMLElement): boolean {
  const chain = ancestry(element, boundary);
  if (!chain) return false;
  for (const current of chain) {
    if (isTimelineNode(current) && (current as HTMLElement).style.display === "none") return false;
    if (current.hasAttribute("data-fd-composition") && (current as HTMLElement).style.visibility === "hidden") return false;
  }
  return true;
}

/** Whether a visual element actually paints in the active timeline branch. */
export function isVisualElementActive(element: Element, boundary: HTMLElement): boolean {
  const chain = ancestry(element, boundary);
  if (!chain || !isTimelineElementActive(element, boundary)) return false;
  for (const current of chain) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

/** Audio ignores its own UA `display:none`, but authored/inactive ancestors still gate it. */
export function isAudioElementActive(element: Element, boundary: HTMLElement): boolean {
  const chain = ancestry(element, boundary);
  if (!chain || !isTimelineElementActive(element, boundary)) return false;
  for (const current of chain.slice(1)) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}
