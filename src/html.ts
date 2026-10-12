import * as vscode from 'vscode';
import type { BootData, ViewerConfig } from './protocol.ts';

export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, config: ViewerConfig): string {
  const dist = vscode.Uri.joinPath(extensionUri, 'dist');
  const asset = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(dist, ...parts)).toString();
  // pdf.js wants a trailing slash on factory URLs; asWebviewUri drops it.
  const dir = (...parts: string[]) => asset(...parts).replace(/\/?$/, '/');

  const boot: BootData = {
    workerUrl: asset('pdfjs', 'pdf.worker.min.mjs'),
    cMapUrl: dir('pdfjs', 'cmaps'),
    standardFontDataUrl: dir('pdfjs', 'standard_fonts'),
    wasmUrl: dir('pdfjs', 'wasm'),
    config,
  };
  const nonce = makeNonce();
  const src = webview.cspSource;
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${src} 'wasm-unsafe-eval'`,
    `style-src ${src} 'unsafe-inline'`,
    `img-src ${src} blob: data:`,
    `font-src ${src} data:`,
    `connect-src ${src}`,
    'worker-src blob:',
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('webview.css')}">
<script type="application/json" id="boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
</head>
<body>
<div id="toolbar" role="toolbar" aria-label="PDF toolbar">
  <div class="group">
    <input id="pageNumber" type="number" min="1" value="1" aria-label="Page number">
    <span id="pageCount">/ 0</span>
  </div>
  <div class="group">
    <button id="zoomOut" title="Zoom out (-)" aria-label="Zoom out">−</button>
    <select id="zoomSelect" aria-label="Zoom">
      <option value="auto">Automatic</option>
      <option value="page-width">Page width</option>
      <option value="page-fit">Page fit</option>
      <option value="page-actual">Actual size</option>
      <option value="0.5">50%</option>
      <option value="0.75">75%</option>
      <option value="1">100%</option>
      <option value="1.5">150%</option>
      <option value="2">200%</option>
      <option value="3">300%</option>
      <option value="4">400%</option>
      <option id="customScale" value="custom" hidden></option>
    </select>
    <button id="zoomIn" title="Zoom in (+)" aria-label="Zoom in">+</button>
  </div>
  <div class="group">
    <select id="schemeSelect" aria-label="Colour scheme" title="Colour scheme (Alt+I toggles)"></select>
  </div>
  <span id="status" role="status"></span>
</div>
<div id="viewerContainer" tabindex="0">
  <div id="viewer" class="pdfViewer"></div>
</div>
<svg width="0" height="0" aria-hidden="true" style="position:absolute">
  <filter id="pdp-filter" color-interpolation-filters="sRGB">
    <feColorMatrix id="pdp-matrix" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>
  </filter>
</svg>
<script type="module" nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}
