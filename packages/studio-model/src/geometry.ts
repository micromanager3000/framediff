export interface Point2D {
  x: number;
  y: number;
}

export interface Rect2D extends Point2D {
  width: number;
  height: number;
}

/** DOMMatrix-compatible 2D affine matrix. */
export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_AFFINE: Affine2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function applyAffine(matrix: Affine2D, point: Point2D): Point2D {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function multiplyAffine(left: Affine2D, right: Affine2D): Affine2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function invertAffine(matrix: Affine2D): Affine2D {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < Number.EPSILON) throw new Error("Cannot invert a collapsed preview transform.");
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

export function composeAffine(options: {
  translate?: Point2D;
  scale?: Point2D;
  rotateDegrees?: number;
}): Affine2D {
  const radians = (options.rotateDegrees ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const scale = options.scale ?? { x: 1, y: 1 };
  return {
    a: cosine * scale.x,
    b: sine * scale.x,
    c: -sine * scale.y,
    d: cosine * scale.y,
    e: options.translate?.x ?? 0,
    f: options.translate?.y ?? 0,
  };
}

/** Convert a pointer delta from preview pixels into authored composition coordinates. */
export function previewDeltaToComposition(matrixToPreview: Affine2D, delta: Point2D): Point2D {
  const inverse = invertAffine(matrixToPreview);
  return {
    x: inverse.a * delta.x + inverse.c * delta.y,
    y: inverse.b * delta.x + inverse.d * delta.y,
  };
}

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** Resize an axis-aligned authored box. Rotation/scaling belongs in matrixToPreview, not persisted here. */
export function resizeRect(
  rect: Rect2D,
  handle: ResizeHandle,
  delta: Point2D,
  options: { minWidth?: number; minHeight?: number; lockAspect?: boolean } = {},
): Rect2D {
  const minWidth = options.minWidth ?? 1;
  const minHeight = options.minHeight ?? 1;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  let width = Math.max(minWidth, rect.width + (east ? delta.x : west ? -delta.x : 0));
  let height = Math.max(minHeight, rect.height + (south ? delta.y : north ? -delta.y : 0));

  if (options.lockAspect && rect.width > 0 && rect.height > 0 && (east || west) && (north || south)) {
    const aspect = rect.width / rect.height;
    if (Math.abs(width - rect.width) / rect.width >= Math.abs(height - rect.height) / rect.height) height = width / aspect;
    else width = height * aspect;
  }

  return {
    x: west ? rect.x + rect.width - width : rect.x,
    y: north ? rect.y + rect.height - height : rect.y,
    width,
    height,
  };
}
