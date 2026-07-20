// Corner-pin math: a projective (homography) map from the unit source quad to 4 destination corners,
// and its inverse (screen → source UV, which the warp shader uses). Square-to-quad is Heckbert's
// "Projective Mappings for Image Warping". Pure + tested.

/** Row-major 3×3: maps a column [u,v,1] → [X,Y,W]; result point = (X/W, Y/W). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Corners are 4 [x,y] points matching the unit-square corners (0,0),(1,0),(1,1),(0,1). */
export function squareToQuad(c: [number, number][]): Mat3 {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = c;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, cc: number, d: number, e: number, f: number, g: number, h: number;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    a = x1 - x0; b = x2 - x1; cc = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0;
  } else {
    const denom = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / denom;
    h = (dx1 * dy3 - dx3 * dy1) / denom;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; cc = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return [a, b, cc, d, e, f, g, h, 1];
}

export function invert3x3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("homography: singular matrix (degenerate corners)");
  const id = 1 / det;
  return [
    A * id, (c * h - b * i) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, (c * d - a * f) * id,
    C * id, (b * g - a * h) * id, (a * e - b * d) * id,
  ];
}

/** Apply a Mat3 to a 2D point (homogeneous), returning the projected point. */
export function applyMat3(m: Mat3, x: number, y: number): [number, number] {
  const X = m[0] * x + m[1] * y + m[2];
  const Y = m[3] * x + m[4] * y + m[5];
  const W = m[6] * x + m[7] * y + m[8];
  return [X / W, Y / W];
}

/** The screen→source map a corner-pin warp samples with: src = Hinv·[screenUV,1]. */
export function cornerPinInverse(corners: [number, number][]): Mat3 {
  return invert3x3(squareToQuad(corners));
}
