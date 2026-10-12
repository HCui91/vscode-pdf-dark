import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMatrix,
  buildMatrix,
  contrastRatio,
  hueKeepingFlip,
  luminance,
  parseHex,
  toHex,
  type HueMode,
  type RGB,
} from '../src/webview/colorMatrix.ts';
import { SCHEMES } from '../src/schemes.ts';

const MODES: HueMode[] = ['balanced', 'css', 'off'];
const TOL = 1 / 255;

// Fixed-colour schemes plus a few theme-like pairs.
const PAIRS: [string, string][] = [
  ...SCHEMES.filter((s) => s.bg && s.fg).map((s) => [s.bg!, s.fg!] as [string, string]),
  ['#1f1f1f', '#cccccc'], // Dark Modern
  ['#1e1e1e', '#d4d4d4'], // Dark+
  ['#ffffff', '#3b3b3b'], // Light Modern
];

// matplotlib tab10 and common ROOT colours.
const PLOT_COLOURS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff',
  '#00ffff', '#ffcc00', '#0099ff', '#ff0033', '#00cc00',
];

function rgb(hex: string): RGB {
  const c = parseHex(hex);
  assert.ok(c, `bad hex ${hex}`);
  return c;
}

function assertClose(a: RGB, b: RGB, msg: string) {
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(a[i] - b[i]) <= TOL, `${msg}: got ${toHex(a)}, want ${toHex(b)}`);
  }
}

test('parseHex handles short and long forms', () => {
  assert.deepEqual(parseHex('#fff'), [1, 1, 1]);
  assert.deepEqual(parseHex('#000000'), [0, 0, 0]);
  assert.equal(parseHex('red'), undefined);
});

test('css weights reproduce CSS hue-rotate(180deg)', () => {
  // Filter Effects spec, hue-rotate with cos = -1, sin = 0.
  const cos = -1;
  const spec = [
    [0.213 + cos * 0.787, 0.715 - cos * 0.715, 0.072 - cos * 0.072],
    [0.213 - cos * 0.213, 0.715 + cos * 0.285, 0.072 - cos * 0.072],
    [0.213 - cos * 0.213, 0.715 - cos * 0.715, 0.072 + cos * 0.928],
  ];
  const h = hueKeepingFlip('css');
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(h[r][c] - spec[r][c]) < 1e-12);
    }
  }
});

test('OLED with css weights equals invert(1) hue-rotate(180deg)', () => {
  const m = buildMatrix([0, 0, 0], [1, 1, 1], 'css');
  const h = hueKeepingFlip('css');
  for (const hex of PLOT_COLOURS) {
    const x = rgb(hex);
    const inv: RGB = [1 - x[0], 1 - x[1], 1 - x[2]];
    const want = [0, 1, 2].map((r) =>
      Math.min(1, Math.max(0, h[r][0] * inv[0] + h[r][1] * inv[1] + h[r][2] * inv[2])),
    ) as unknown as RGB;
    assertClose(applyMatrix(m, x), want, hex);
  }
});

test('white maps to bg and black maps to fg', () => {
  for (const [bgHex, fgHex] of PAIRS) {
    for (const mode of MODES) {
      const bg = rgb(bgHex);
      const fg = rgb(fgHex);
      const m = buildMatrix(bg, fg, mode);
      assert.equal(m.length, 20);
      assert.deepEqual(m.slice(15), [0, 0, 0, 1, 0]);
      assertClose(applyMatrix(m, [1, 1, 1]), bg, `${bgHex}/${fgHex} ${mode} white`);
      assertClose(applyMatrix(m, [0, 0, 0]), fg, `${bgHex}/${fgHex} ${mode} black`);
    }
  }
});

test('greys stay monotonic', () => {
  for (const [bgHex, fgHex] of PAIRS) {
    const m = buildMatrix(rgb(bgHex), rgb(fgHex), 'balanced');
    const out = [0, 0.25, 0.5, 0.75, 1].map((g) => applyMatrix(m, [g, g, g])[1]);
    const dir = Math.sign(out[4] - out[0]);
    for (let i = 1; i < out.length; i++) {
      assert.ok(Math.sign(out[i] - out[i - 1]) === dir || out[i] === out[i - 1], `${bgHex}/${fgHex}`);
    }
  }
});

test('primaries keep their main channel on dark pages', () => {
  const m = (mode: HueMode) => buildMatrix(rgb('#1f1f1f'), rgb('#cccccc'), mode);
  for (const mode of ['balanced', 'css'] as const) {
    const red = applyMatrix(m(mode), [1, 0, 0]);
    const blue = applyMatrix(m(mode), [0, 0, 1]);
    assert.ok(red[0] > red[1] && red[0] > red[2], `${mode} red ${toHex(red)}`);
    assert.ok(blue[2] > blue[0] && blue[2] > blue[1], `${mode} blue ${toHex(blue)}`);
  }
  // Plain inversion turns red into cyan.
  const red = applyMatrix(m('off'), [1, 0, 0]);
  assert.ok(red[1] > red[0] && red[2] > red[0], `off red ${toHex(red)}`);
});

test('light targets do not invert', () => {
  for (const bgHex of ['#ffffff', '#f4ecd8']) {
    const m = buildMatrix(rgb(bgHex), rgb('#3b3b3b'), 'balanced');
    const red = applyMatrix(m, [1, 0, 0]);
    assert.ok(red[0] > red[1] && red[0] > red[2], `${bgHex} red ${toHex(red)}`);
    // Darker in, darker out.
    assert.ok(applyMatrix(m, [0.2, 0.2, 0.2])[0] < applyMatrix(m, [0.8, 0.8, 0.8])[0]);
  }
});

function worstContrast(bgHex: string, fgHex: string, mode: HueMode): number {
  const bg = rgb(bgHex);
  const m = buildMatrix(bg, rgb(fgHex), mode);
  return Math.min(...PLOT_COLOURS.map((hex) => contrastRatio(applyMatrix(m, rgb(hex)), bg)));
}

test('balanced weights keep plot colours visible on high-contrast dark pages', () => {
  for (const [bgHex, fgHex] of [['#1f1f1f', '#cccccc'], ['#000000', '#ffffff']]) {
    const cr = worstContrast(bgHex, fgHex, 'balanced');
    assert.ok(cr >= 2.5, `${bgHex}/${fgHex} worst contrast ${cr.toFixed(2)}`);
  }
});

test('balanced weights beat css weights on every dark pair', () => {
  for (const [bgHex, fgHex] of PAIRS.filter(([b, f]) => luminance(rgb(b)) <= luminance(rgb(f)))) {
    assert.ok(worstContrast(bgHex, fgHex, 'balanced') > worstContrast(bgHex, fgHex, 'css'), `${bgHex}/${fgHex}`);
  }
});

test('css weights make yellow nearly vanish (why balanced is the default)', () => {
  const bg = rgb('#000000');
  const out = applyMatrix(buildMatrix(bg, rgb('#ffffff'), 'css'), rgb('#ffff00'));
  assert.ok(contrastRatio(out, bg) < 1.5, toHex(out));
});
