// 3D color LUTs: parse a .cube file, or synthesize a look. A LUT3D is `size³` RGB triplets with the
// RED index varying fastest (the .cube convention), ready to upload as a WebGPU 3D texture and sample
// trilinearly in the grade pass (effects/grade.ts).

export interface LUT3D {
  size: number;
  /** size³ × 3 floats in [0,1], R fastest then G then B: data[(r + g*size + b*size²)*3 + c]. */
  data: Float32Array;
}

export function parseCubeLUT(text: string): LUT3D {
  let size = 0;
  const out: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith("LUT_3D_SIZE")) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (upper.startsWith("TITLE") || upper.startsWith("DOMAIN_") || upper.startsWith("LUT_1D_SIZE")) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) out.push(parts[0], parts[1], parts[2]);
  }
  if (!size || out.length !== size * size * size * 3) {
    throw new Error(`invalid .cube LUT: LUT_3D_SIZE=${size}, parsed ${out.length / 3} entries (need ${size ** 3})`);
  }
  return { size, data: new Float32Array(out) };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * A warm "gold rush"–style filmic LUT (stand-in for the editor's `SL GOLD RUSH LDR.itx`, which lives
 * on their drive): warm highlights, slightly cooler/teal shadows, a gentle S-curve. Deterministic.
 */
export function generateWarmGoldLUT(size = 33): LUT3D {
  const data = new Float32Array(size * size * size * 3);
  const n = size - 1;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  // a filmic S-curve that DEEPENS shadows and gently rolls highlights (adds contrast — no black lift)
  const contrast = (x: number) => clamp01(x + (smooth(x) - x) * 0.5);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        let R = contrast(r / n);
        let G = contrast(g / n);
        let B = contrast(b / n);
        const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const hi = Math.max(0, L - 0.5) * 2; // 0..1 in the highlights
        const lo = Math.max(0, 0.5 - L) * 2; // 0..1 in the shadows
        // teal-orange: warm/gold highlights, slightly teal (cool) shadows — kept rich, not lifted
        R = R + 0.07 * hi - 0.03 * lo;
        G = G + 0.018 * hi - 0.004 * lo;
        B = B - 0.06 * hi + 0.03 * lo;
        data[i++] = clamp01(R);
        data[i++] = clamp01(G);
        data[i++] = clamp01(B);
      }
    }
  }
  return { size, data };
}

/** Pack a LUT3D into RGBA8 for a WebGPU `rgba8unorm` 3D texture (a = 255). */
export function lutToRGBA8(lut: LUT3D): Uint8Array<ArrayBuffer> {
  const { size, data } = lut;
  const out = new Uint8Array(size * size * size * 4);
  for (let j = 0; j < size * size * size; j++) {
    out[j * 4 + 0] = Math.round(clamp01(data[j * 3 + 0]) * 255);
    out[j * 4 + 1] = Math.round(clamp01(data[j * 3 + 1]) * 255);
    out[j * 4 + 2] = Math.round(clamp01(data[j * 3 + 2]) * 255);
    out[j * 4 + 3] = 255;
  }
  return out;
}
