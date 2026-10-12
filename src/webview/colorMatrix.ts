// Builds the feColorMatrix that recolours a rendered PDF page.
// White on the page maps to `bg`, black maps to `fg`.
// All colours are sRGB triples in [0, 1].

export type RGB = readonly [number, number, number];
export type HueMode = 'balanced' | 'css' | 'off';

// Lightness weights for the hue-keeping inversion H = 2·1·wᵀ − I.
// `css` reproduces CSS hue-rotate(180deg) exactly. `balanced` gives more
// weight to blue so bright yellow and green don't collapse to near black.
export const HUE_WEIGHTS: Record<Exclude<HueMode, 'off'>, RGB> = {
  css: [0.213, 0.715, 0.072],
  balanced: [0.22, 0.58, 0.2],
};

export function parseHex(hex: string): RGB | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return undefined;
  }
  let h = m[1];
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function toHex(c: RGB): string {
  return '#' + c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}

// WCAG relative luminance.
export function luminance(c: RGB): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// 3×3 matrix that flips lightness and keeps hue. Row-major.
export function hueKeepingFlip(mode: HueMode): number[][] {
  if (mode === 'off') {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }
  const w = HUE_WEIGHTS[mode];
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => 2 * w[c] - (r === c ? 1 : 0)));
}

// Returns the 20 values of an feColorMatrix (4 rows × 5 columns).
export function buildMatrix(bg: RGB, fg: RGB, mode: HueMode): number[] {
  const rows: number[][] = [];
  if (luminance(bg) > luminance(fg)) {
    // Light target: scale towards bg without inverting, so hues stay put.
    for (let c = 0; c < 3; c++) {
      const row = [0, 0, 0, 0, fg[c]];
      row[c] = bg[c] - fg[c];
      rows.push(row);
    }
  } else {
    // Dark target: out = fg − (fg − bg)·(H x).
    const h = hueKeepingFlip(mode);
    for (let c = 0; c < 3; c++) {
      const d = fg[c] - bg[c];
      rows.push([-d * h[c][0], -d * h[c][1], -d * h[c][2], 0, fg[c]]);
    }
  }
  rows.push([0, 0, 0, 1, 0]);
  return rows.flat().map((v) => (Object.is(v, -0) ? 0 : v));
}

// Applies a matrix from buildMatrix to an opaque colour, as the SVG filter does.
export function applyMatrix(m: readonly number[], x: RGB): RGB {
  const out = [0, 1, 2].map((r) =>
    clamp01(m[r * 5] * x[0] + m[r * 5 + 1] * x[1] + m[r * 5 + 2] * x[2] + m[r * 5 + 3] + m[r * 5 + 4]),
  );
  return [out[0], out[1], out[2]];
}

// The colour white maps to, used for the page background before rendering.
export function mappedWhite(m: readonly number[]): RGB {
  return applyMatrix(m, [1, 1, 1]);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
