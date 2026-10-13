import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreset, presetScale, type FitInput } from '../src/webview/zoom.ts';

// A matplotlib 6×4 in page is 576×384 CSS px at scale 1.
const landscape = { pageWidth: 576, pageHeight: 384 };
// A4 portrait.
const portrait = { pageWidth: 794, pageHeight: 1123 };

function input(page: { pageWidth: number; pageHeight: number }, pages: number, w: number, h: number): FitInput {
  return {
    ...page,
    pageHeights: Array(pages).fill(page.pageHeight),
    gap: 10,
    viewWidth: w,
    viewHeight: h,
    scrollbar: 10,
  };
}

test('presets are recognised', () => {
  assert.ok(isPreset('auto') && isPreset('page-width') && isPreset('page-fit') && isPreset('page-actual'));
  assert.ok(!isPreset('1.5') && !isPreset(''));
});

test('page-width fills the pane when no scrollbar is needed', () => {
  const s = presetScale('page-width', input(landscape, 1, 1200, 1000));
  assert.ok(Math.abs(s * 576 - 1199) < 1e-9);
});

test('page-width leaves room for the scrollbar when pages overflow', () => {
  const s = presetScale('page-width', input(landscape, 3, 1200, 1000));
  assert.ok(Math.abs(s * 576 - (1200 - 10 - 1)) < 1e-9);
});

test('page-fit shows the whole page', () => {
  const f = input(landscape, 1, 1600, 600);
  const s = presetScale('page-fit', f);
  assert.ok(s * 384 <= 600 && s * 576 <= 1600);
  assert.ok(Math.abs(s * 384 - 599) < 1e-9);
});

test('auto fits landscape pages whole and portrait pages by width', () => {
  assert.equal(presetScale('auto', input(landscape, 1, 1600, 600)), presetScale('page-fit', input(landscape, 1, 1600, 600)));
  assert.equal(presetScale('auto', input(portrait, 5, 900, 700)), presetScale('page-width', input(portrait, 5, 900, 700)));
});

test('auto is not capped at 125%', () => {
  assert.ok(presetScale('auto', input(landscape, 1, 2000, 1500)) > 3);
});

test('page-actual is 100%', () => {
  assert.equal(presetScale('page-actual', input(portrait, 1, 500, 500)), 1);
});

test('a single page that just fits does not count the gap', () => {
  // Fits exactly in height: no scrollbar, so the full width is used.
  const s = presetScale('page-fit', input(landscape, 1, 3000, 400));
  assert.ok(Math.abs(s * 384 - 399) < 1e-9);
});
