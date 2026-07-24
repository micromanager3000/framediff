export type VisualFitMode = "native" | "resize" | "cover" | "contain" | "stretch";

export interface NormalizedCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A visual-only transform. Crop coordinates are normalized against the source media. */
export interface VisualAdaptation {
  fit: VisualFitMode;
  crop?: NormalizedCropRegion;
  matte?: string;
}

export type DimensionRelation =
  | "exact"
  | "larger-both"
  | "smaller-both"
  | "larger-width"
  | "larger-height"
  | "smaller-width"
  | "smaller-height"
  | "mixed";

export interface VisualGeometryClassification {
  relation: DimensionRelation;
  label: string;
  detail: string;
  widthRatio: number;
  heightRatio: number;
  aspectMatches: boolean;
  allowedFits: VisualFitMode[];
  recommendedFit: VisualFitMode;
  scaling: "none" | "up" | "down" | "mixed";
}

const EPSILON = 0.0005;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function classifyVisualGeometry(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): VisualGeometryClassification {
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  const tw = Math.max(1, targetWidth);
  const th = Math.max(1, targetHeight);
  const widthRatio = tw / sw;
  const heightRatio = th / sh;
  const widthDirection = Math.abs(widthRatio - 1) <= EPSILON ? 0 : widthRatio > 1 ? 1 : -1;
  const heightDirection = Math.abs(heightRatio - 1) <= EPSILON ? 0 : heightRatio > 1 ? 1 : -1;
  const aspectMatches = Math.abs(sw / sh - tw / th) <= EPSILON;

  let relation: DimensionRelation;
  let label: string;
  let detail: string;
  if (widthDirection === 0 && heightDirection === 0) {
    relation = "exact";
    label = "Exact match";
    detail = "No resizing or cropping is needed.";
  } else if (widthDirection > 0 && heightDirection > 0) {
    relation = "larger-both";
    label = "Target is larger in both dimensions";
    detail = "Both axes need upscaling.";
  } else if (widthDirection < 0 && heightDirection < 0) {
    relation = "smaller-both";
    label = "Target is smaller in both dimensions";
    detail = "Both axes need downscaling.";
  } else if (widthDirection > 0 && heightDirection === 0) {
    relation = "larger-width";
    label = "Target is wider";
    detail = "Only the width is larger.";
  } else if (widthDirection === 0 && heightDirection > 0) {
    relation = "larger-height";
    label = "Target is taller";
    detail = "Only the height is larger.";
  } else if (widthDirection < 0 && heightDirection === 0) {
    relation = "smaller-width";
    label = "Target is narrower";
    detail = "Only the width is smaller.";
  } else if (widthDirection === 0 && heightDirection < 0) {
    relation = "smaller-height";
    label = "Target is shorter";
    detail = "Only the height is smaller.";
  } else {
    relation = "mixed";
    label = widthDirection > 0
      ? "Target is wider and shorter"
      : "Target is narrower and taller";
    detail = "One axis needs upscaling while the other needs downscaling.";
  }

  const scaling = relation === "exact"
    ? "none"
    : widthDirection >= 0 && heightDirection >= 0
      ? "up"
      : widthDirection <= 0 && heightDirection <= 0
        ? "down"
        : "mixed";
  const allowedFits: VisualFitMode[] = relation === "exact"
    ? ["native"]
    : aspectMatches
      ? ["resize"]
      : ["cover", "contain", "stretch"];

  return {
    relation,
    label,
    detail,
    widthRatio,
    heightRatio,
    aspectMatches,
    allowedFits,
    recommendedFit: relation === "exact" ? "native" : aspectMatches ? "resize" : "cover",
    scaling,
  };
}

/** Largest centered crop with the target aspect, optionally zoomed further into the source. */
export function cropRegionForTargetAspect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  centerX = 0.5,
  centerY = 0.5,
  zoom = 1,
): NormalizedCropRegion {
  const sourceAspect = Math.max(1, sourceWidth) / Math.max(1, sourceHeight);
  const targetAspect = Math.max(1, targetWidth) / Math.max(1, targetHeight);
  const safeZoom = clamp(zoom, 0.05, 1);
  const width = (sourceAspect > targetAspect ? targetAspect / sourceAspect : 1) * safeZoom;
  const height = (sourceAspect > targetAspect ? 1 : sourceAspect / targetAspect) * safeZoom;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

export function normalizeCropRegion(region: NormalizedCropRegion): NormalizedCropRegion {
  const width = clamp(region.width, 0.01, 1);
  const height = clamp(region.height, 0.01, 1);
  return {
    x: clamp(region.x, 0, 1 - width),
    y: clamp(region.y, 0, 1 - height),
    width,
    height,
  };
}

export function cropRegionMatchesTargetAspect(
  region: NormalizedCropRegion,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): boolean {
  const normalized = normalizeCropRegion(region);
  const croppedAspect =
    (Math.max(1, sourceWidth) * normalized.width) /
    (Math.max(1, sourceHeight) * normalized.height);
  const targetAspect = Math.max(1, targetWidth) / Math.max(1, targetHeight);
  return Math.abs(croppedAspect - targetAspect) <= Math.max(0.001, targetAspect * 0.002);
}

/** Preserve crop focus and relative zoom when either the source or target geometry changes. */
export function retargetCropRegion(
  region: NormalizedCropRegion,
  previousSourceWidth: number,
  previousSourceHeight: number,
  previousTargetWidth: number,
  previousTargetHeight: number,
  nextSourceWidth: number,
  nextSourceHeight: number,
  nextTargetWidth: number,
  nextTargetHeight: number,
): NormalizedCropRegion {
  const normalized = normalizeCropRegion(region);
  const previousMaximum = cropRegionForTargetAspect(
    previousSourceWidth,
    previousSourceHeight,
    previousTargetWidth,
    previousTargetHeight,
  );
  const zoom = clamp(
    Math.min(
      normalized.width / previousMaximum.width,
      normalized.height / previousMaximum.height,
    ),
    0.05,
    1,
  );
  return cropRegionForTargetAspect(
    nextSourceWidth,
    nextSourceHeight,
    nextTargetWidth,
    nextTargetHeight,
    normalized.x + normalized.width / 2,
    normalized.y + normalized.height / 2,
    zoom,
  );
}
