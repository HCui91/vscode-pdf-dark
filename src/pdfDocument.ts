import * as vscode from 'vscode';
import type { ReloadConfig } from './config.ts';
import { log } from './log.ts';
import { looksComplete } from './pdfBytes.ts';
import type { FileStatus } from './protocol.ts';

const DEBOUNCE_MS = 300;
const STABLE_GAP_MS = 200;
const STABLE_TRIES = 10;
const INCOMPLETE_MAX_WAIT_MS = 8000;
// Bytes above this size are re-read on demand instead of kept in memory.
const CACHE_LIMIT = 50 * 1024 * 1024;

export interface Snapshot {
  version: number;
  data: Uint8Array;
}

interface StatKey {
  mtime: number;
  size: number;
}

// A PDF file on disk. Watches it and decides when the preview should reload.
export class PdfDocument implements vscode.CustomDocument {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeContent = this.changeEmitter.event;
  private readonly statusEmitter = new vscode.EventEmitter<FileStatus>();
  readonly onDidChangeStatus = this.statusEmitter.event;
  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposeEmitter.event;

  private key: StatKey | undefined;
  private bytes: Uint8Array | undefined;
  // Whether the accepted bytes had a PDF header and trailer.
  private complete = true;
  private _version = 0;
  private _status: FileStatus = 'ok';
  private queue: Promise<void> = Promise.resolve();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly visiblePanels = new Set<unknown>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    readonly uri: vscode.Uri,
    private reloadConfig: ReloadConfig,
  ) {
    this.disposables.push(this.changeEmitter, this.statusEmitter);
    this.watch();
  }

  get version(): number {
    return this._version;
  }

  get status(): FileStatus {
    return this._status;
  }

  // Bytes of the latest accepted version, reading the file if needed.
  async snapshot(): Promise<Snapshot | undefined> {
    if (!this.key) {
      await this.check(true);
    }
    if (!this.key) {
      return undefined;
    }
    const data = this.bytes ?? (await vscode.workspace.fs.readFile(this.uri));
    return { version: this._version, data };
  }

  // Serialised. `force` re-reads even when mtime and size look unchanged.
  check(force: boolean): Promise<void> {
    this.queue = this.queue.then(() => this.runCheck(force)).catch((err) => log.error(`${this.uri.toString()}:`, err));
    return this.queue;
  }

  scheduleCheck(): void {
    if (!this.reloadConfig.enabled) {
      return;
    }
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.check(false), DEBOUNCE_MS);
  }

  setPanelVisible(panel: unknown, visible: boolean): void {
    const wasVisible = this.visiblePanels.size > 0;
    if (visible) {
      this.visiblePanels.add(panel);
    } else {
      this.visiblePanels.delete(panel);
    }
    if (!wasVisible && visible && this.key && this.reloadConfig.enabled) {
      // Catch changes made while every panel was hidden.
      void this.check(false);
    }
    this.updatePoll();
  }

  updateReloadConfig(config: ReloadConfig): void {
    this.reloadConfig = config;
    this.updatePoll();
  }

  dispose(): void {
    clearTimeout(this.debounceTimer);
    clearInterval(this.pollTimer);
    this.disposeEmitter.fire();
    this.disposeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private watch(): void {
    const dir = vscode.Uri.joinPath(this.uri, '..');
    let watcher: vscode.FileSystemWatcher;
    try {
      // '*' rather than the file name: names like fig[1].pdf are globs.
      watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, '*'));
    } catch {
      return; // Some virtual file systems can't be watched.
    }
    const onEvent = (e: vscode.Uri) => {
      if (e.path === this.uri.path) {
        this.scheduleCheck();
      }
    };
    this.disposables.push(
      watcher,
      watcher.onDidChange(onEvent),
      watcher.onDidCreate(onEvent),
      watcher.onDidDelete(onEvent),
    );
  }

  private shouldPoll(): boolean {
    const { enabled, poll } = this.reloadConfig;
    if (!enabled || poll === 'never' || this.visiblePanels.size === 0) {
      return false;
    }
    // inotify misses writes made on other machines to AFS and EOS.
    return poll === 'always' || /^\/(afs|eos)\//.test(this.uri.path);
  }

  private updatePoll(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    if (this.shouldPoll()) {
      this.pollTimer = setInterval(() => void this.check(false), this.reloadConfig.pollIntervalMs);
      log.debug(`polling ${this.uri.path} every ${this.reloadConfig.pollIntervalMs} ms`);
    }
  }

  private setStatus(status: FileStatus): void {
    if (status !== this._status) {
      this._status = status;
      log.info(`${this.uri.path}: ${status}`);
      this.statusEmitter.fire(status);
    }
  }

  private async stat(): Promise<StatKey | undefined> {
    try {
      const s = await vscode.workspace.fs.stat(this.uri);
      return { mtime: s.mtime, size: s.size };
    } catch {
      return undefined;
    }
  }

  private async runCheck(force: boolean): Promise<void> {
    let key = await this.stat();
    if (!key) {
      this.setStatus('missing');
      return;
    }
    if (!force && this.key && sameKey(key, this.key)) {
      this.setStatus(this.complete ? 'ok' : 'incomplete');
      return;
    }

    // Wait until the writer stops: two equal stats in a row. The first
    // read skips this; the trailer check below still guards it.
    for (let i = 0; this.key && i < STABLE_TRIES; i++) {
      await delay(STABLE_GAP_MS);
      const next = await this.stat();
      if (!next) {
        this.setStatus('missing');
        return;
      }
      if (sameKey(next, key)) {
        break;
      }
      key = next;
    }

    // pdf.js parses truncated files leniently, so check the trailer ourselves.
    let data: Uint8Array;
    let waited = 0;
    let backoff = 250;
    for (;;) {
      try {
        data = await vscode.workspace.fs.readFile(this.uri);
      } catch {
        this.setStatus('missing');
        return;
      }
      if (looksComplete(data) || waited >= INCOMPLETE_MAX_WAIT_MS) {
        break;
      }
      this.setStatus('incomplete');
      await delay(backoff);
      waited += backoff;
      backoff = Math.min(backoff * 2, 2000);
      key = (await this.stat()) ?? key;
    }

    if (!force && this.bytes && equalBytes(data, this.bytes)) {
      // Touched or rewritten with the same content: nothing to redraw.
      this.key = key;
      this.setStatus(this.complete ? 'ok' : 'incomplete');
      return;
    }
    this.key = key;
    this.bytes = data.byteLength <= CACHE_LIMIT ? data : undefined;
    this.complete = looksComplete(data);
    this._version++;
    log.info(`${this.uri.path}: version ${this._version}, ${data.byteLength} bytes${this.complete ? '' : ' (incomplete)'}`);
    this.setStatus(this.complete ? 'ok' : 'incomplete');
    this.changeEmitter.fire();
  }
}

function sameKey(a: StatKey, b: StatKey): boolean {
  return a.mtime === b.mtime && a.size === b.size;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
