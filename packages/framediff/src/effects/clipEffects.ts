import type { ClipEffect } from "../studio/types";
import type { GradeParams } from "./grade";
import type { LUT3D } from "./lut";

const gradeDefaults: Record<keyof GradeParams, number> = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 1,
  vignette: 0,
  lutIntensity: 0,
  bloom: 0,
  bloomThreshold: 0.6,
};

export function colorGradeEffect(
  grade: GradeParams | undefined,
  lut: LUT3D | "gold" | undefined,
  lutIntensity = 1,
  lutName?: string,
): ClipEffect[] | undefined {
  const entries = Object.entries(grade ?? {}).filter(([key, value]) => {
    if (typeof value !== "number") return false;
    return value !== gradeDefaults[key as keyof GradeParams];
  });
  const hasLut = !!lut;
  if (!entries.length && !hasLut) return undefined;
  return [{
    type: "color-grade",
    grade: entries.length ? Object.fromEntries(entries) : undefined,
    lut: hasLut ? (lut === "gold" ? "gold" : "custom") : undefined,
    lutIntensity: hasLut ? lutIntensity : undefined,
    lutName: lutName ?? (lut === "gold" ? "gold" : undefined),
  }];
}
