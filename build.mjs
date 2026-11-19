// Builds the single self-contained index.html (and PWA icons) from src/ + npm libraries.
// Usage: npm install && npm run build
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const read = p => readFileSync(p, 'utf8');
const lib = p => read('node_modules/' + p);

// Make JS safe to embed inside a <script> element; the result must still be valid JS.
function embed(name, js) {
  const out = js.replace(/<\/script/gi, '\\x3C/script').replace(/<!--/g, '\\x3C!--').replace(/<script/gi, '\\x3Cscript');
  new vm.Script(out, { filename: name });   // throws if escaping broke the syntax
  return out;
}

const katexDir = 'node_modules/katex/dist/';
const katexCss = read(katexDir + 'katex.min.css').replace(
  /src:url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\)[^;}]*/g,
  (m, f) => `src:url(data:font/woff2;base64,${readFileSync(`${katexDir}fonts/${f}.woff2`).toString('base64')}) format("woff2")`
);
if (/url\(fonts\//.test(katexCss)) throw new Error('KaTeX font inlining failed');

const iconSvg = (pad, radius) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="#1f6feb"/><g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"><path d="M92 352V160l82 104 82-104v192"/><path d="M372 160v184M308 284l64 68 64-68"/></g></svg>`;

const parts = {
  FAVICON: encodeURIComponent(iconSvg(0, 96)),
  CSS: read('src/app.css'),
  JS: embed('app.js', read('src/app.js')),
  LIB_MARKED: embed('marked', lib('marked/lib/marked.umd.js')),
  LIB_PURIFY: embed('purify', lib('dompurify/dist/purify.min.js').replace(/\n\/\/# sourceMappingURL=.*$/m, '')),
  LIB_HLJS: embed('hljs', lib('@highlightjs/cdn-assets/highlight.min.js') + '\n;globalThis.hljs=hljs;'),
  LIB_KATEX: embed('katex', lib('katex/dist/katex.min.js')),
  LIB_KATEX_CSS: katexCss,
  LIB_MERMAID: embed('mermaid', lib('mermaid/dist/mermaid.min.js')
    .replace('globalThis.__esbuild_esm_mermaid_nm["mermaid"].default', '__esbuild_esm_mermaid_nm["mermaid"].default')),
};
if (!parts.LIB_MERMAID.includes('globalThis["mermaid"] = __esbuild_esm_mermaid_nm')) throw new Error('mermaid bundle layout changed');
if (/<\/script/i.test(parts.LIB_KATEX_CSS)) throw new Error('unexpected markup in KaTeX CSS');

const html = read('src/template.html').replace(/%%([A-Z_]+)%%/g, (m, k) => {
  if (!(k in parts)) throw new Error('Unknown placeholder ' + k);
  return parts[k];
});
writeFileSync('index.html', html);
console.log(`index.html  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB`);

// PWA icons (rendered with the Chromium that ships with Playwright)
if (process.argv.includes('--icons') || !existsSync('icons/icon-512.png')) {
  const { chromium } = require('playwright');
  mkdirSync('icons', { recursive: true });
  const browser = await chromium.launch();
  for (const [file, size, pad, radius] of [['icon-192.png', 192, 0, 96], ['icon-512.png', 512, 0, 96], ['icon-maskable-512.png', 512, 0.3, 0]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${iconSvg(pad, radius)}`);
    await page.screenshot({ path: 'icons/' + file, omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log('icons written');
}
