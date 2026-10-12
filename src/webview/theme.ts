// Turns the chosen scheme into the SVG colour matrix on the page canvases.

import type { ViewerConfig } from '../protocol.ts';
import { findScheme } from '../schemes.ts';
import { buildMatrix, mappedWhite, parseHex, toHex, type RGB } from './colorMatrix.ts';

const DARK_FALLBACK: [RGB, RGB] = [parseHex('#1e1e1e')!, parseHex('#d4d4d4')!];
const LIGHT_FALLBACK: [RGB, RGB] = [parseHex('#ffffff')!, parseHex('#3b3b3b')!];

export class Theme {
  private config: ViewerConfig | undefined;
  private readonly probe = document.createElement('span');
  private readonly matrixEl = document.getElementById('pdp-matrix')!;
  private frame = 0;

  constructor() {
    this.probe.style.display = 'none';
    document.body.append(this.probe);
    // VS Code updates these when the colour theme changes.
    const observer = new MutationObserver(() => this.scheduleApply());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  setConfig(config: ViewerConfig): void {
    this.config = config;
    this.apply();
  }

  private scheduleApply(): void {
    if (this.config?.scheme !== 'vscodeTheme' || this.frame) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.apply();
    });
  }

  private apply(): void {
    const config = this.config;
    const root = document.documentElement;
    if (!config || config.scheme === 'off') {
      root.classList.remove('pdp-on');
      root.style.removeProperty('--pdp-page-bg');
      return;
    }
    const [bg, fg] = this.resolveColours(config);
    const matrix = buildMatrix(bg, fg, config.hueMode);
    this.matrixEl.setAttribute('values', matrix.map((v) => +v.toFixed(5)).join(' '));
    root.style.setProperty('--pdp-page-bg', toHex(mappedWhite(matrix)));
    root.classList.add('pdp-on');
  }

  private resolveColours(config: ViewerConfig): [RGB, RGB] {
    const isLight = document.body.classList.contains('vscode-light');
    const fallback = isLight ? LIGHT_FALLBACK : DARK_FALLBACK;
    if (config.scheme === 'vscodeTheme') {
      const style = getComputedStyle(document.documentElement);
      const bg = this.cssColour(style.getPropertyValue('--vscode-editor-background'));
      const fg = this.cssColour(style.getPropertyValue('--vscode-editor-foreground'));
      return [bg ?? fallback[0], fg ?? fallback[1]];
    }
    if (config.scheme === 'custom') {
      return [parseHex(config.customBg) ?? DARK_FALLBACK[0], parseHex(config.customFg) ?? DARK_FALLBACK[1]];
    }
    const s = findScheme(config.scheme);
    return [parseHex(s.bg ?? '') ?? fallback[0], parseHex(s.fg ?? '') ?? fallback[1]];
  }

  // Normalise any CSS colour (hex, rgb(), named) through the browser.
  private cssColour(value: string): RGB | undefined {
    value = value.trim();
    if (!value) {
      return undefined;
    }
    this.probe.style.color = '';
    this.probe.style.color = value;
    if (!this.probe.style.color) {
      return undefined;
    }
    const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(getComputedStyle(this.probe).color);
    return m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255] : undefined;
  }
}
