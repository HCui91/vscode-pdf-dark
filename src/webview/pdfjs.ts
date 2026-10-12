// pdf_viewer.mjs reads globalThis.pdfjsLib when it loads, so pdf.mjs must be
// evaluated first. Keep both imports in this one module, in this order.
export { AnnotationMode, getDocument, GlobalWorkerOptions, VerbosityLevel } from 'pdfjs-dist';
export type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
export { EventBus, LinkTarget, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';

// AnnotationEditorType.DISABLE; skips building the annotation editor UI.
export const ANNOTATION_EDITOR_DISABLE = -1;
