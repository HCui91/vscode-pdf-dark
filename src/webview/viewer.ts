// Wraps pdf.js PDFViewer: loading, reloading in place, zoom.

import type { BootData } from '../protocol.ts';
import {
  ANNOTATION_EDITOR_DISABLE,
  AnnotationMode,
  EventBus,
  getDocument,
  LinkTarget,
  PDFLinkService,
  PDFViewer,
  VerbosityLevel,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from './pdfjs.ts';

export interface ViewState {
  scale: string;
  pageNumber: number;
  left: number;
  top: number;
}

export class Viewer {
  readonly eventBus = new EventBus();
  readonly pdfViewer: PDFViewer;
  private readonly linkService: PDFLinkService;
  private task: PDFDocumentLoadingTask | undefined;
  private doc: PDFDocumentProxy | undefined;
  private generation = 0;
  private location: ViewState | undefined;
  private pendingRestore: ViewState | undefined;
  // A pdf.js scale value: a preset name or a factor such as "1.5".
  defaultZoom = 'auto';

  constructor(
    readonly container: HTMLDivElement,
    private readonly boot: BootData,
    private readonly onViewChange: (state: ViewState) => void,
  ) {
    this.linkService = new PDFLinkService({ eventBus: this.eventBus, externalLinkTarget: LinkTarget.BLANK });
    this.pdfViewer = new PDFViewer({
      container,
      eventBus: this.eventBus,
      linkService: this.linkService,
      annotationMode: AnnotationMode.ENABLE,
      annotationEditorMode: ANNOTATION_EDITOR_DISABLE,
    });
    this.linkService.setViewer(this.pdfViewer);

    this.eventBus.on('pagesinit', () => this.onPagesInit());
    this.eventBus.on('updateviewarea', ({ location }: { location?: ViewState & { scale: number | string } }) => {
      if (!location) {
        return;
      }
      this.location = {
        scale: String(this.pdfViewer.currentScaleValue),
        pageNumber: location.pageNumber,
        left: location.left,
        top: location.top,
      };
      this.onViewChange(this.location);
    });
  }

  get hasDocument(): boolean {
    return !!this.doc;
  }

  // Resolves to the page count, or throws. A newer call makes older ones no-ops.
  async load(data: Uint8Array, restore: ViewState | undefined): Promise<number | undefined> {
    const gen = ++this.generation;
    const task = getDocument({
      data,
      cMapUrl: this.boot.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: this.boot.standardFontDataUrl,
      wasmUrl: this.boot.wasmUrl,
      // Keep asset fetches on the main thread; it would switch on for https URLs.
      useWorkerFetch: false,
      enableXfa: false,
      verbosity: VerbosityLevel.ERRORS,
    });
    let doc: PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch (err) {
      void task.destroy();
      if (gen !== this.generation) {
        return undefined;
      }
      throw err;
    }
    if (gen !== this.generation) {
      void task.destroy();
      return undefined;
    }

    // Keep the current view across a reload.
    this.pendingRestore = restore ?? this.location;
    const oldTask = this.task;
    this.task = task;
    this.doc = doc;
    this.pdfViewer.setDocument(doc);
    this.linkService.setDocument(doc, null);
    void oldTask?.destroy();
    return doc.numPages;
  }

  setZoom(value: string): void {
    if (!this.doc) {
      return;
    }
    this.pdfViewer.currentScaleValue = value;
  }

  resetZoom(): void {
    this.setZoom(this.defaultZoom);
  }

  zoomBy(steps: number): void {
    if (steps > 0) {
      this.pdfViewer.increaseScale({ steps });
    } else {
      this.pdfViewer.decreaseScale({ steps: -steps });
    }
  }

  zoomAt(change: { scaleFactor: number } | { steps: number }, clientX: number, clientY: number): void {
    this.pdfViewer.updateScale({ ...change, origin: [clientX, clientY], drawingDelay: 400 });
  }

  private onPagesInit(): void {
    const r = this.pendingRestore;
    this.pendingRestore = undefined;
    this.pdfViewer.currentScaleValue = r?.scale ?? this.defaultZoom;
    if (r) {
      const pageNumber = Math.min(Math.max(1, r.pageNumber), this.pdfViewer.pagesCount);
      this.pdfViewer.scrollPageIntoView({
        pageNumber,
        destArray: [null, { name: 'XYZ' }, r.left, r.top, null],
        allowNegativeOffset: true,
      });
    }
  }
}

// The setting takes a percentage ("150"); pdf.js takes a factor ("1.5") or a preset.
export function zoomFromSetting(value: string): string {
  return /^\d+$/.test(value) ? String(Number(value) / 100) : value || 'auto';
}
