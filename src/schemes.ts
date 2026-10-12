// Colour scheme presets. Shared by the extension (QuickPick) and the webview.

export type SchemeId = 'vscodeTheme' | 'oled' | 'oneDark' | 'solarizedDark' | 'sepia' | 'custom' | 'off';

export interface Scheme {
  readonly id: SchemeId;
  readonly label: string;
  readonly description: string;
  // Fixed colours. Absent for schemes that resolve them at run time.
  readonly bg?: string;
  readonly fg?: string;
}

export const SCHEMES: readonly Scheme[] = [
  { id: 'vscodeTheme', label: 'VS Code theme', description: 'Editor background and foreground' },
  { id: 'oled', label: 'OLED', description: 'Pure black and white', bg: '#000000', fg: '#ffffff' },
  { id: 'oneDark', label: 'One Dark', description: 'Dimmed contrast', bg: '#282c34', fg: '#abb2bf' },
  { id: 'solarizedDark', label: 'Solarized Dark', description: '', bg: '#002b36', fg: '#839496' },
  { id: 'sepia', label: 'Sepia', description: 'Warm light page', bg: '#f4ecd8', fg: '#5b4636' },
  { id: 'custom', label: 'Custom', description: 'Colours from settings' },
  { id: 'off', label: 'Original', description: 'No recolouring' },
];

export const DEFAULT_SCHEME: SchemeId = 'vscodeTheme';

export function isSchemeId(v: unknown): v is SchemeId {
  return SCHEMES.some((s) => s.id === v);
}

export function findScheme(id: SchemeId): Scheme {
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
}
