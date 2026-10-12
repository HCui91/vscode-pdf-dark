import * as vscode from 'vscode';
import type { HueMode } from './webview/colorMatrix.ts';
import type { ViewerConfig } from './protocol.ts';
import { DEFAULT_SCHEME, isSchemeId, type SchemeId } from './schemes.ts';

export const SECTION = 'pdfPreviewDark';

export type PollMode = 'auto' | 'always' | 'never';

export interface ReloadConfig {
  enabled: boolean;
  poll: PollMode;
  pollIntervalMs: number;
}

const HUE_MODES: readonly HueMode[] = ['balanced', 'css', 'off'];
const POLL_MODES: readonly PollMode[] = ['auto', 'always', 'never'];

export function readViewerConfig(): ViewerConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const scheme = c.get<string>('colorScheme');
  const hueMode = c.get<HueMode>('hueMode', 'balanced');
  return {
    scheme: isSchemeId(scheme) ? scheme : DEFAULT_SCHEME,
    customBg: c.get<string>('customColors.background', '#1e1e1e'),
    customFg: c.get<string>('customColors.foreground', '#d4d4d4'),
    hueMode: HUE_MODES.includes(hueMode) ? hueMode : 'balanced',
    defaultZoom: c.get<string>('defaultZoom', 'auto'),
  };
}

export function readReloadConfig(): ReloadConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const poll = c.get<PollMode>('reload.poll', 'auto');
  return {
    enabled: c.get<boolean>('reload.enabled', true),
    poll: POLL_MODES.includes(poll) ? poll : 'auto',
    pollIntervalMs: Math.max(0.5, c.get<number>('reload.pollInterval', 2)) * 1000,
  };
}

// Write to the scope that already sets the value, so a workspace value
// doesn't silently override a global write.
export async function writeScheme(scheme: SchemeId): Promise<void> {
  const c = vscode.workspace.getConfiguration(SECTION);
  const info = c.inspect<string>('colorScheme');
  const target =
    info?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await c.update('colorScheme', scheme, target);
}
