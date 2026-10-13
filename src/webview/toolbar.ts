import { SCHEMES, type SchemeId } from '../schemes.ts';
import type { Viewer } from './viewer.ts';

export class Toolbar {
  private readonly pageNumber = el<HTMLInputElement>('pageNumber');
  private readonly pageCount = el<HTMLSpanElement>('pageCount');
  private readonly zoomSelect = el<HTMLSelectElement>('zoomSelect');
  private readonly customScale = el<HTMLOptionElement>('customScale');
  private readonly schemeSelect = el<HTMLSelectElement>('schemeSelect');
  private readonly status = el<HTMLSpanElement>('status');

  constructor(viewer: Viewer, onScheme: (scheme: SchemeId) => void) {
    const { eventBus, pdfViewer } = viewer;

    eventBus.on('pagesinit', () => {
      this.pageNumber.max = String(pdfViewer.pagesCount);
      this.pageCount.textContent = `/ ${pdfViewer.pagesCount}`;
    });
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      this.pageNumber.value = String(pageNumber);
    });
    this.pageNumber.addEventListener('change', () => {
      const n = Math.round(Number(this.pageNumber.value));
      if (n >= 1 && n <= pdfViewer.pagesCount) {
        pdfViewer.currentPageNumber = n;
      } else {
        this.pageNumber.value = String(pdfViewer.currentPageNumber);
      }
    });

    el('zoomOut').addEventListener('click', () => viewer.zoomBy(-1));
    el('zoomIn').addEventListener('click', () => viewer.zoomBy(1));
    this.zoomSelect.addEventListener('change', () => {
      if (this.zoomSelect.value !== 'custom') {
        viewer.setZoom(this.zoomSelect.value);
      }
    });
    viewer.onZoomChange = (mode, scale) => this.showZoom(mode, scale);

    for (const s of SCHEMES) {
      this.schemeSelect.append(new Option(s.label, s.id));
    }
    this.schemeSelect.addEventListener('change', () => onScheme(this.schemeSelect.value as SchemeId));
  }

  setScheme(scheme: SchemeId): void {
    this.schemeSelect.value = scheme;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
    this.status.title = text;
  }

  private showZoom(mode: string, scale: number): void {
    const match = [...this.zoomSelect.options].find(
      (o) => o !== this.customScale && (o.value === mode || Number(o.value) === Number(mode)),
    );
    if (match) {
      this.customScale.hidden = true;
      this.zoomSelect.value = match.value;
    } else {
      this.customScale.textContent = `${Math.round(scale * 100)}%`;
      this.customScale.hidden = false;
      this.zoomSelect.value = 'custom';
    }
  }
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
