/** Map a parent-local frame into a child composition's frame space. */
export function mapNestedFrame(
  parentLocalFrame: number,
  parentFps: number,
  child: { fps: number; durationInFrames: number },
  trimStartSec = 0,
  playbackRate = 1,
): number {
  const frame = (parentLocalFrame / parentFps * playbackRate + trimStartSec) * child.fps;
  return Math.max(0, Math.min(child.durationInFrames - 1e-6, frame));
}
