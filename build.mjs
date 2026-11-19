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

// Outlined bold "M": left leg ends in the Markdown down-arrow, right leg is a pencil with eraser and tip.
const iconArt = `<g fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><path d="M120 304V154H170L256 266L342 154V140a14 14 0 0 1 14-14h22a14 14 0 0 1 14 14V314L367 370L342 314V232L256 344L170 232V304H202L145 370L88 304Z"/><path d="M342 154H392M342 314H392"/><path fill="#fff" stroke-width="6" d="M358 350h18l-9 20z"/></g>`;
// shape: 'circle' (transparent corners) or 'full' (full-bleed square for Android maskable icons)
const iconSvg = (shape = 'circle') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${shape === 'full'
  ? `<rect width="512" height="512" fill="#a81a32"/><g transform="translate(256 256) scale(.72) translate(-256 -256)">${iconArt}</g>`
  : `<circle cx="256" cy="256" r="240" fill="#a81a32"/>${iconArt}`}</svg>`;

const parts = {
  FAVICON: encodeURIComponent(iconSvg()),
  LOGO: iconSvg(),
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
mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon.svg', iconSvg() + '\n');
console.log(`index.html  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB`);

// PWA icons (rendered with the Chromium that ships with Playwright)
if (process.argv.includes('--icons') || !existsSync('icons/icon-512.png')) {
  const { chromium } = require('playwright');
  mkdirSync('icons', { recursive: true });
  const browser = await chromium.launch();
  for (const [file, size, shape] of [['icon-192.png', 192, 'circle'], ['icon-512.png', 512, 'circle'], ['icon-maskable-512.png', 512, 'full']]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${iconSvg(shape)}`);
    await page.screenshot({ path: 'icons/' + file, omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log('icons written');
}
