import * as vscode from 'vscode';
import { readViewerConfig, SECTION, writeScheme } from './config.ts';
import { log } from './log.ts';
import { PdfPreviewProvider } from './pdfPreviewProvider.ts';
import { DEFAULT_SCHEME, isSchemeId, SCHEMES, type SchemeId } from './schemes.ts';

const LAST_SCHEME_KEY = 'lastDarkScheme';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PdfPreviewProvider(context.extensionUri);

  context.subscriptions.push(
    log,
    vscode.window.registerCustomEditorProvider(PdfPreviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: false, enableFindWidget: true },
      supportsMultipleEditorsPerDocument: true,
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECTION)) {
        provider.broadcastConfig();
        provider.updateReloadConfig();
      }
    }),

    vscode.commands.registerCommand('pdfPreviewDark.selectScheme', () => selectScheme(provider)),

    vscode.commands.registerCommand('pdfPreviewDark.toggleDark', async () => {
      const current = readViewerConfig().scheme;
      if (current !== 'off') {
        await context.globalState.update(LAST_SCHEME_KEY, current);
        await writeScheme('off');
      } else {
        const last = context.globalState.get<string>(LAST_SCHEME_KEY);
        await writeScheme(isSchemeId(last) && last !== 'off' ? last : DEFAULT_SCHEME);
      }
    }),

    vscode.commands.registerCommand('pdfPreviewDark.reload', () => provider.activeDocument?.check(true)),
  );
}

async function selectScheme(provider: PdfPreviewProvider): Promise<void> {
  const config = readViewerConfig();
  const items = SCHEMES.map((s) => ({ label: s.label, description: s.description, id: s.id }));
  const pick = vscode.window.createQuickPick<(typeof items)[number]>();
  pick.title = 'PDF colour scheme';
  pick.items = items;
  pick.activeItems = items.filter((i) => i.id === config.scheme);

  let chosen: SchemeId | undefined;
  pick.onDidChangeActive(([item]) => {
    if (item && provider.hasPanels) {
      provider.broadcastConfig({ ...config, scheme: item.id });
    }
  });
  pick.onDidAccept(() => {
    chosen = pick.selectedItems[0]?.id;
    pick.hide();
  });
  await new Promise<void>((resolve) => pick.onDidHide(() => resolve()));
  pick.dispose();

  if (chosen && chosen !== config.scheme) {
    await writeScheme(chosen);
  }
  // Drop the preview; the saved setting (new or old) takes over.
  provider.broadcastConfig();
}

export function deactivate(): void {}
