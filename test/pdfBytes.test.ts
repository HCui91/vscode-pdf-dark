import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksComplete } from '../src/pdfBytes.ts';

// A small one-page PDF with a 4 KB content stream, so the trailer sits well
// past the first kilobyte.
function makePdf(): Uint8Array {
  const content = 'BT /F1 12 Tf 20 100 Td (plot) Tj ET\n'.repeat(120);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const pdf = makePdf();

test('a whole PDF looks complete', () => {
  assert.ok(pdf.byteLength > 4096);
  assert.ok(looksComplete(pdf));
});

test('truncated PDFs do not look complete', () => {
  for (let n = 0; n < pdf.byteLength - 2; n += 13) {
    assert.ok(!looksComplete(pdf.subarray(0, n)), `prefix of ${n} bytes`);
  }
});

test('a trailing newline after %%EOF is fine', () => {
  assert.ok(looksComplete(new Uint8Array([...pdf, 0x0a, 0x0a])));
});

test('data without a PDF header is rejected', () => {
  assert.ok(!looksComplete(new TextEncoder().encode('x'.repeat(200) + '%%EOF\n')));
});
