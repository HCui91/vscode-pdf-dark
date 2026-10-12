// Byte-level checks on PDF files. No vscode imports, so tests can load it.

// True when the file starts with a PDF header and ends with an EOF marker.
// pdf.js parses truncated files leniently, so we check this ourselves.
export function looksComplete(data: Uint8Array): boolean {
  if (data.byteLength < 64) {
    return false;
  }
  const head = latin1(data.subarray(0, Math.min(1024, data.byteLength)));
  const tail = latin1(data.subarray(Math.max(0, data.byteLength - 2048)));
  return head.includes('%PDF-') && tail.includes('%%EOF');
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return s;
}
