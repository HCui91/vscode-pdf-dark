// Builds the extension, the webview bundle and its CSS, and copies the
// pdf.js files that are loaded at run time.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
};

const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['src/webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'esm',
    target: 'chrome128',
  },
  {
    ...common,
    entryPoints: ['src/webview/style.css'],
    outfile: 'dist/webview.css',
    target: 'chrome128',
    loader: { '.svg': 'dataurl', '.gif': 'dataurl', '.png': 'dataurl' },
  },
];

function copyPdfjsAssets() {
  const from = 'node_modules/pdfjs-dist';
  const to = 'dist/pdfjs';
  rmSync(to, { recursive: true, force: true });
  mkdirSync(`${to}/wasm`, { recursive: true });
  cpSync(`${from}/LICENSE`, `${to}/LICENSE`);
  cpSync(`${from}/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
  cpSync(`${from}/cmaps`, `${to}/cmaps`, { recursive: true });
  cpSync(`${from}/standard_fonts`, `${to}/standard_fonts`, { recursive: true });
  // JPEG 2000 and JBIG2 decoders. qcms (ICC) is unused with useWorkerFetch off.
  for (const f of [
    'openjpeg.wasm',
    'openjpeg_nowasm_fallback.js',
    'jbig2.wasm',
    'jbig2_nowasm_fallback.js',
    'LICENSE_OPENJPEG',
    'LICENSE_PDFJS_OPENJPEG',
    'LICENSE_JBIG2',
    'LICENSE_PDFJS_JBIG2',
  ]) {
    cpSync(`${from}/wasm/${f}`, `${to}/wasm/${f}`);
  }
}

if (production) {
  rmSync('dist', { recursive: true, force: true });
}
copyPdfjsAssets();
if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
