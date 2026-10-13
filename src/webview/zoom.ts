// Scale for the zoom presets. pdf.js has its own, but it caps "auto" at 125%,
// keeps a fixed 40 px gap for the scrollbar, and doesn't refit on resize.

export type ZoomPreset = 'auto' | 'page-width' | 'page-fit' | 'page-actual';

const PRESETS: readonly string[] = ['auto', 'page-width', 'page-fit', 'page-actual'];

export function isPreset(value: string): value is ZoomPreset {
  return PRESETS.includes(value);
}

export interface FitInput {
  // Size of the current page at scale 1, in CSS px.
  pageWidth: number;
  pageHeight: number;
  // Heights of all pages at scale 1.
  pageHeights: readonly number[];
  // Space between pages.
  gap: number;
  // Viewer size without a scrollbar.
  viewWidth: number;
  viewHeight: number;
  // Width a vertical scrollbar takes when shown.
  scrollbar: number;
}

// "auto" fits the whole page for landscape pages (most plots) and the width
// for portrait pages.
export function presetScale(preset: ZoomPreset, f: FitInput): number {
  if (preset === 'page-actual') {
    return 1;
  }
  const mode = preset === 'auto' ? (f.pageWidth > f.pageHeight ? 'page-fit' : 'page-width') : preset;
  // 1 px slack, so rounding never adds a scrollbar.
  const fit = (width: number) => {
    const widthScale = (width - 1) / f.pageWidth;
    return mode === 'page-width' ? widthScale : Math.min(widthScale, (f.viewHeight - 1) / f.pageHeight);
  };
  const scale = fit(f.viewWidth);
  const total = f.pageHeights.reduce((sum, h) => sum + h * scale, 0) + f.gap * (f.pageHeights.length - 1);
  // A vertical scrollbar will show, so fit into the space left beside it.
  return total > f.viewHeight ? fit(f.viewWidth - f.scrollbar) : scale;
}
