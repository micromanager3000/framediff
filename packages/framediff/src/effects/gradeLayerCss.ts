import type { GradeParams } from "./grade";

const fmt = (n: number) => +n.toFixed(4);

/** Shared preview/export CSS-filter mapping for an HTML `data-fd-grade-layer`. */
export function gradeLayerFilter(grade: GradeParams): string {
  const exposure = grade.exposure ?? 0;
  const contrast = grade.contrast ?? 0;
  const saturation = grade.saturation ?? 1;
  const temperature = grade.temperature ?? 0;
  const parts: string[] = [];
  if (exposure) parts.push(`brightness(${fmt(2 ** exposure)})`);
  if (contrast) parts.push(`contrast(${fmt(Math.max(0, 1 + contrast))})`);
  if (saturation !== 1) parts.push(`saturate(${fmt(Math.max(0, saturation))})`);
  if (temperature > 0) {
    const warmSaturation = fmt(1 + temperature * 0.12);
    parts.push(`sepia(${fmt(Math.min(1, temperature * 0.35))})`, `saturate(${warmSaturation})`);
  } else if (temperature < 0) {
    parts.push("invert(1)", `sepia(${fmt(Math.min(1, -temperature * 0.35))})`, "invert(1)");
  }
  return parts.join(" ");
}

export function gradeLayerVignette(vignette: number): string {
  const value = Math.max(0, Math.min(1, vignette));
  return `radial-gradient(circle, rgba(0,0,0,0) 55%, rgba(0,0,0,${fmt(value)}) 100%)`;
}
