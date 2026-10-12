// Messages between the extension and the webview. Types only.

import type { HueMode } from './webview/colorMatrix.ts';
import type { SchemeId } from './schemes.ts';

export interface ViewerConfig {
  scheme: SchemeId;
  customBg: string;
  customFg: string;
  hueMode: HueMode;
  defaultZoom: string;
}

export type FileStatus = 'ok' | 'missing' | 'incomplete';

export type LoadReason = 'open' | 'reload';

// Extension → webview.
export type ToWebview =
  | { type: 'config'; config: ViewerConfig }
  | { type: 'load'; version: number; data: Uint8Array; reason: LoadReason }
  | { type: 'fileStatus'; status: FileStatus };

// Webview → extension.
export type FromWebview =
  | { type: 'ready' }
  | { type: 'loaded'; version: number; pages: number }
  | { type: 'loadError'; version: number; message: string }
  | { type: 'setScheme'; scheme: SchemeId };

// Asset URLs and the first config, embedded in the HTML.
export interface BootData {
  workerUrl: string;
  cMapUrl: string;
  standardFontDataUrl: string;
  wasmUrl: string;
  config: ViewerConfig;
}
