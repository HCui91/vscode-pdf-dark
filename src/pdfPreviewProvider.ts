import * as vscode from 'vscode';
import { readReloadConfig, readViewerConfig, writeScheme } from './config.ts';
import { getHtml } from './html.ts';
import { log } from './log.ts';
import { PdfDocument } from './pdfDocument.ts';
import type { FromWebview, LoadReason, ToWebview, ViewerConfig } from './protocol.ts';
import { isSchemeId } from './schemes.ts';

interface Panel {
  readonly webviewPanel: vscode.WebviewPanel;
  readonly doc: PdfDocument;
  // Version last posted to the current webview context, -1 when none.
  sentVersion: number;
}

export class PdfPreviewProvider implements vscode.CustomReadonlyEditorProvider<PdfDocument> {
  static readonly viewType = 'pdfPreviewDark.preview';

  private readonly panels = new Set<Panel>();
  private readonly documents = new Set<PdfDocument>();
  private active: Panel | undefined;
  // Temporary config while the scheme QuickPick is open.
  private previewConfig: ViewerConfig | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  openCustomDocument(uri: vscode.Uri): PdfDocument {
    const doc = new PdfDocument(uri, readReloadConfig());
    this.documents.add(doc);
    const sub = doc.onDidChangeContent(() => {
      for (const p of this.panelsOf(doc)) {
        if (p.webviewPanel.visible) {
          void this.sendLatest(p, 'reload');
        }
      }
    });
    const statusSub = doc.onDidChangeStatus((status) => {
      for (const p of this.panelsOf(doc)) {
        this.post(p, { type: 'fileStatus', status });
      }
    });
    doc.onDidDispose(() => {
      sub.dispose();
      statusSub.dispose();
      this.documents.delete(doc);
    });
    return doc;
  }

  resolveCustomEditor(doc: PdfDocument, webviewPanel: vscode.WebviewPanel): void {
    const panel: Panel = { webviewPanel, doc, sentVersion: -1 };
    this.panels.add(panel);

    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
    webview.html = getHtml(webview, this.extensionUri, this.currentConfig());

    const subs: vscode.Disposable[] = [
      webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(panel, msg)),
      webviewPanel.onDidChangeViewState(() => this.onViewState(panel)),
    ];
    webviewPanel.onDidDispose(() => {
      subs.forEach((s) => s.dispose());
      doc.setPanelVisible(panel, false);
      this.panels.delete(panel);
      if (this.active === panel) {
        this.active = undefined;
      }
    });
    this.onViewState(panel);
  }

  get activeDocument(): PdfDocument | undefined {
    return this.active?.doc;
  }

  get hasPanels(): boolean {
    return this.panels.size > 0;
  }

  // Push config to every panel. Pass a config to preview it without saving.
  broadcastConfig(preview?: ViewerConfig): void {
    this.previewConfig = preview;
    const config = this.currentConfig();
    for (const p of this.panels) {
      this.post(p, { type: 'config', config });
    }
  }

  updateReloadConfig(): void {
    const config = readReloadConfig();
    for (const d of this.documents) {
      d.updateReloadConfig(config);
    }
  }

  private currentConfig(): ViewerConfig {
    return this.previewConfig ?? readViewerConfig();
  }

  private panelsOf(doc: PdfDocument): Panel[] {
    return [...this.panels].filter((p) => p.doc === doc);
  }

  private onViewState(panel: Panel): void {
    const { webviewPanel, doc } = panel;
    if (webviewPanel.active) {
      this.active = panel;
    } else if (this.active === panel) {
      this.active = undefined;
    }
    doc.setPanelVisible(panel, webviewPanel.visible);
  }

  private async onMessage(panel: Panel, msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        // A fresh webview context (first open, or shown again after hiding).
        panel.sentVersion = -1;
        this.post(panel, { type: 'config', config: this.currentConfig() });
        this.post(panel, { type: 'fileStatus', status: panel.doc.status });
        await this.sendLatest(panel, 'open');
        break;
      case 'loadError':
        log.warn(`${panel.doc.uri.path}: pdf.js could not load version ${msg.version}: ${msg.message}`);
        break;
      case 'setScheme':
        if (isSchemeId(msg.scheme)) {
          await writeScheme(msg.scheme);
        }
        break;
      case 'loaded':
        log.info(`${panel.doc.uri.path}: shown version ${msg.version}, ${msg.pages} pages`);
        break;
    }
  }

  private async sendLatest(panel: Panel, reason: LoadReason): Promise<void> {
    const snap = await panel.doc.snapshot();
    if (!snap) {
      this.post(panel, { type: 'fileStatus', status: 'missing' });
      return;
    }
    if (snap.version === panel.sentVersion || !this.panels.has(panel)) {
      return;
    }
    panel.sentVersion = snap.version;
    // readFile may return a Node Buffer, which the webview can't rebuild.
    const data = new Uint8Array(snap.data.buffer, snap.data.byteOffset, snap.data.byteLength);
    this.post(panel, { type: 'load', version: snap.version, data, reason });
  }

  private post(panel: Panel, msg: ToWebview): void {
    void panel.webviewPanel.webview.postMessage(msg);
  }
}
