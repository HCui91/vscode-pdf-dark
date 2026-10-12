import type { BootData, FileStatus, FromWebview, ToWebview, ViewerConfig } from '../protocol.ts';
import type { SchemeId } from '../schemes.ts';
import { GlobalWorkerOptions } from './pdfjs.ts';
import { Theme } from './theme.ts';
import { Toolbar } from './toolbar.ts';
import { Viewer, zoomFromSetting, type ViewState } from './viewer.ts';

interface VsCodeApi {
  postMessage(msg: FromWebview): void;
  getState(): SavedState | undefined;
  setState(state: SavedState): void;
}
interface SavedState {
  view?: ViewState;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const boot = JSON.parse(document.getElementById('boot')!.textContent!) as BootData;

// Colours first, so nothing flashes white while pdf.js starts.
const theme = new Theme();
theme.setConfig(boot.config);

const workerReady = setupWorker(boot.workerUrl);

let saveTimer = 0;
const viewer = new Viewer(document.getElementById('viewerContainer') as HTMLDivElement, boot, (view) => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => vscode.setState({ view }), 250);
});

let config = boot.config;
const toolbar = new Toolbar(viewer, (scheme: SchemeId) => {
  // Apply now; the extension saves it and echoes the config back.
  applyConfig({ ...config, scheme });
  vscode.postMessage({ type: 'setScheme', scheme });
});
applyConfig(boot.config);

let loadedVersion = -1;
let fileStatusText = '';
let errorText = '';

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'config':
      applyConfig(msg.config);
      break;
    case 'load':
      void load(msg.version, msg.data, msg.reason === 'open' ? vscode.getState()?.view : undefined);
      break;
    case 'fileStatus':
      fileStatusText = statusText(msg.status);
      showStatus();
      break;
  }
});

installInput();
vscode.postMessage({ type: 'ready' });

function applyConfig(next: ViewerConfig): void {
  config = next;
  theme.setConfig(next);
  toolbar.setScheme(next.scheme);
  viewer.defaultZoom = zoomFromSetting(next.defaultZoom);
}

async function load(version: number, data: unknown, restore: ViewState | undefined): Promise<void> {
  if (version <= loadedVersion && viewer.hasDocument) {
    return;
  }
  await workerReady;
  try {
    const pages = await viewer.load(asBytes(data), restore);
    if (pages === undefined) {
      return; // A newer load took over.
    }
    loadedVersion = version;
    errorText = '';
    vscode.postMessage({ type: 'loaded', version, pages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorText = `Could not load PDF: ${message}`;
    vscode.postMessage({ type: 'loadError', version, message });
  }
  showStatus();
}

function asBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data && typeof data === 'object') {
    return Uint8Array.from(Object.values(data as Record<string, number>));
  }
  throw new Error('no PDF data received');
}

function showStatus(): void {
  toolbar.setStatus(errorText || fileStatusText);
}

function statusText(status: FileStatus): string {
  switch (status) {
    case 'missing':
      return 'File not found';
    case 'incomplete':
      return 'Waiting for the file to finish writing…';
    default:
      return '';
  }
}

// VS Code webviews only allow workers from blob: URLs. Check that the worker
// starts; if not, run pdf.js on the main thread instead.
async function setupWorker(url: string): Promise<void> {
  GlobalWorkerOptions.workerSrc = url;
  try {
    const source = await (await fetch(url)).text();
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(blobUrl, { type: 'module' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker timed out')), 10000);
      worker.addEventListener('message', () => (clearTimeout(timer), resolve()), { once: true });
      worker.addEventListener('error', (e) => (clearTimeout(timer), reject(new Error(e.message))), { once: true });
    });
    GlobalWorkerOptions.workerPort = worker;
  } catch (err) {
    console.warn('[pdf-preview-dark] worker failed, using main thread:', err);
    // Sets globalThis.pdfjsWorker, which pdf.js picks up instead of a worker.
    await import(/* @vite-ignore */ url);
  }
}

function installInput(): void {
  const container = viewer.container;
  container.addEventListener(
    'wheel',
    (e) => {
      // Ctrl/Cmd + wheel, and trackpad pinch (which sets ctrlKey).
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) {
        return;
      }
      e.preventDefault();
      // Pinch sends small pixel deltas: zoom smoothly. Mouse wheels: one step per tick.
      const pinch = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(e.deltaY) < 50;
      const change = pinch ? { scaleFactor: Math.exp(-e.deltaY / 100) } : { steps: -Math.sign(e.deltaY) };
      viewer.zoomAt(change, e.clientX, e.clientY);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    const inField = e.target instanceof Element && e.target.matches('input, select, textarea');
    if (e.ctrlKey || e.metaKey || e.altKey || inField) {
      return;
    }
    if (e.key === '+' || e.key === '=') {
      viewer.zoomBy(1);
    } else if (e.key === '-' || e.key === '_') {
      viewer.zoomBy(-1);
    } else if (e.key === '0') {
      viewer.resetZoom();
    } else {
      return;
    }
    e.preventDefault();
  });

  container.focus();
}
