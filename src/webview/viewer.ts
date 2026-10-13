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
import { isPreset, presetScale } from './zoom.ts';

// Space below each page, from pdf.js's removePageBorders style.
const PAGE_GAP = 10;

export interface ViewState {
  // Zoom mode: a preset name or a factor such as "1.5".
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
  // A preset name or a factor such as "1.5". Presets refit when the pane resizes.
  defaultZoom = 'auto';
  private zoomMode = 'auto';
  private applyingZoom = false;
  private refitFrame = 0;
  private readonly scrollbarWidth = measureScrollbar();
  onZoomChange: ((mode: string, scale: number) => void) | undefined;

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
      // Drops pdf.js's fixed 40 px side gap; zoom.ts handles the scrollbar.
      removePageBorders: true,
    });
    this.linkService.setViewer(this.pdfViewer);

    this.eventBus.on('pagesinit', () => this.onPagesInit());
    // Real page sizes are known once all pages load.
    this.eventBus.on('pagesloaded', () => this.scheduleRefit());
    this.eventBus.on('scalechanging', ({ scale }: { scale: number }) => {
      if (!this.applyingZoom) {
        // Zoomed by hand (keys, buttons, wheel): keep this scale on resize.
        this.zoomMode = String(scale);
      }
      this.onZoomChange?.(this.zoomMode, scale);
    });
    // Border box, so a scrollbar showing or hiding doesn't trigger a refit.
    new ResizeObserver(() => this.scheduleRefit()).observe(container, { box: 'border-box' });
    this.eventBus.on('updateviewarea', ({ location }: { location?: ViewState & { scale: number | string } }) => {
      if (!location) {
        return;
      }
      this.location = {
        scale: this.zoomMode,
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
    this.zoomMode = value;
    this.applyZoom();
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

  private scheduleRefit(): void {
    if (this.refitFrame || !isPreset(this.zoomMode)) {
      return;
    }
    this.refitFrame = requestAnimationFrame(() => {
      this.refitFrame = 0;
      if (isPreset(this.zoomMode)) {
        this.applyZoom();
      }
    });
  }

  private applyZoom(): void {
    const viewer = this.pdfViewer;
    if (!this.doc || viewer.pagesCount === 0) {
      return;
    }
    let scale: number;
    if (isPreset(this.zoomMode)) {
      const sizeAt1 = (i: number) => {
        const view = viewer.getPageView(i);
        return { width: view.width / view.scale, height: view.height / view.scale };
      };
      const page = sizeAt1(viewer.currentPageNumber - 1);
      scale = presetScale(this.zoomMode, {
        pageWidth: page.width,
        pageHeight: page.height,
        pageHeights: Array.from({ length: viewer.pagesCount }, (_, i) => sizeAt1(i).height),
        gap: PAGE_GAP,
        viewWidth: this.container.offsetWidth,
        viewHeight: this.container.offsetHeight,
        scrollbar: this.scrollbarWidth,
      });
    } else {
      scale = parseFloat(this.zoomMode);
    }
    if (!(scale > 0)) {
      return;
    }
    this.applyingZoom = true;
    try {
      viewer.currentScale = scale;
    } finally {
      this.applyingZoom = false;
    }
    this.onZoomChange?.(this.zoomMode, viewer.currentScale);
  }

  private onPagesInit(): void {
    const r = this.pendingRestore;
    this.pendingRestore = undefined;
    this.zoomMode = r?.scale ?? this.defaultZoom;
    this.applyZoom();
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

// Width a vertical scrollbar takes, with VS Code's scrollbar style.
function measureScrollbar(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-1000px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

// The setting takes a percentage ("150"); pdf.js takes a factor ("1.5") or a preset.
export function zoomFromSetting(value: string): string {
  return /^\d+$/.test(value) ? String(Number(value) / 100) : value || 'auto';
}
