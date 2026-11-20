(() => {
'use strict';

const $ = id => document.getElementById(id);
const ta = $('ed'), pv = $('pv'), pvBody = $('pvBody'), tocEl = $('toc'), mirror = $('mirror');
const menu = $('menu'), scrim = $('scrim'), menuBtn = $('menuBtn');
const DRAFT_KEY = 'mded.draft.v1';
const RECENT_KEY = 'mded.recent.v1';
const DEFAULT_NAME = 'untitled.md';
const TOP_GAP = 8;            // px kept above the line that is aligned to the top of a view
const TASK_RE = /^([\s>]*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

const st = {
  name: DEFAULT_NAME, dirty: false, handle: null, view: 'edit',
  line: 0,              // source line currently aligned to the top of the views
  rendered: null,       // text the preview DOM was built from
  headings: [],         // {level, text, line, n, el}
};

/* ------------------------------------------------------------------ utils */
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isAbort = e => e && (e.name === 'AbortError' || e.name === 'NotAllowedError' && /abort|cancel/i.test(e.message || ''));

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function confirmDiscard(what) {
  if (!st.dirty || !ta.value.trim()) return Promise.resolve(true);
  const dlg = $('dlg');
  $('dlgText').textContent = `"${st.name}" has unsaved changes. Discard them and ${what}?`;
  if (!dlg.showModal) return Promise.resolve(confirm($('dlgText').textContent));
  return new Promise(res => {
    const done = v => { dlg.close(); $('dlgOk').onclick = $('dlgCancel').onclick = dlg.oncancel = null; res(v); };
    $('dlgOk').onclick = () => done(true);
    $('dlgCancel').onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

/* tiny key/value store in IndexedDB – used to remember the file handle between launches */
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('mded', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbSet(key, val) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      if (val == null) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error);
    });
    db.close();
  } catch (e) { /* storage unavailable (e.g. opened as a local file) */ }
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    const v = await new Promise((res, rej) => {
      const rq = db.transaction('kv').objectStore('kv').get(key);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    db.close(); return v;
  } catch (e) { return undefined; }
}

/* ------------------------------------------------------------------ draft */
let draftTimer, draftWarned = false;
function saveDraft() {
  clearTimeout(draftTimer); draftTimer = 0;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      text: ta.value, name: st.name, dirty: st.dirty, view: st.view, line: st.line,
      edScroll: ta.scrollTop, sel: ta.selectionStart, hasHandle: !!st.handle,
    }));
  } catch (e) {
    if (!draftWarned) { draftWarned = true; toast('Draft autosave is not available here – save your file manually'); }
  }
}
function saveDraftSoon() { if (!draftTimer) draftTimer = setTimeout(saveDraft, 400); }
function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }

function updateUi() {
  document.title = (st.dirty ? '• ' : '') + st.name + ' – Markdown Editor';
  $('fileName').textContent = st.name;
  $('fileState').textContent = st.dirty ? 'Unsaved changes (draft kept automatically)' : (st.handle ? 'Saved' : 'No changes');
  $('dirtyDot').hidden = !st.dirty;
}
function setDirty(d) { st.dirty = d; updateUi(); saveDraftSoon(); }

/* ------------------------------------------------------------ lazy libs */
const libs = {};
function loadLib(id) {
  if (id in libs) return libs[id];
  const el = $(id);
  try { (0, eval)(el.textContent); libs[id] = true; el.remove(); }
  catch (e) { console.error('Failed to load ' + id, e); libs[id] = false; }
  return libs[id];
}
function loadKatex() {
  if (!loadLib('lib-katex')) return false;
  const css = $('lib-katex-css');
  if (css) { const s = document.createElement('style'); s.textContent = css.textContent; document.head.appendChild(s); css.remove(); }
  return true;
}

/* -------------------------------------------------------------- markdown */
const md = new marked.Marked({ gfm: true });
md.use({ extensions: [
  { name: 'mathBlock', level: 'block',
    start(src) { const m = /(?:^|\n) {0,3}\$\$/.exec(src); return m ? m.index + (m[0][0] === '\n' ? 1 : 0) : undefined; },
    tokenizer(src) {
      const m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
      if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
    },
    renderer(t) { return `<div class="math math-d"><code>${esc(t.text)}</code></div>\n`; } },
  { name: 'mathInline', level: 'inline',
    start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      let m = /^\$\$([^$\n]+?)\$\$/.exec(src);
      if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
      m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
      if (m) return { type: 'mathInline', raw: m[0], text: m[1] };
    },
    renderer(t) { return `<span class="math${t.display ? ' math-d' : ''}"><code>${esc(t.text)}</code></span>`; } },
] });

DOMPurify.addHook('afterSanitizeAttributes', n => {
  if (n.tagName === 'A' && n.hasAttribute('href') && !n.getAttribute('href').startsWith('#')) {
    n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer');
  }
});

const slug = s => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
const mermaidCache = new Map();
let mermaidSeq = 0, pvAnchorTop = -1;

function render() {
  const text = ta.value;
  if (st.rendered === text) return;
  st.rendered = text; st.headings = [];
  const frag = document.createDocumentFragment();
  let tokens;
  try { tokens = md.lexer(text); } catch (e) { console.error(e); tokens = [{ type: 'code', raw: text, text }]; }
  let line = 0;
  for (const t of tokens) {
    const raw = t.raw || '';
    if (t.type !== 'space' && t.type !== 'def') {
      const one = [t]; one.links = tokens.links;
      let html;
      try { html = md.parser(one); } catch (e) { html = `<pre>${esc(raw)}</pre>`; }
      const d = document.createElement('div');
      d.className = 'blk';
      d._line = line;
      d._n = raw.replace(/\n+$/, '').split('\n').length;
      d.appendChild(DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }));
      if (t.type === 'heading') st.headings.push({ level: t.depth, text: d.textContent.trim(), line, n: d._n, el: d });
      frag.appendChild(d);
    }
    line += (raw.match(/\n/g) || []).length;
  }
  if (!frag.childNodes.length) {
    const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing to preview yet. Write something in Edit.';
    frag.appendChild(p);
  }
  pvBody.replaceChildren(frag);
  enhance(text);
}

function enhance(text) {
  // task checkboxes: enable only where they can be mapped back to source lines unambiguously
  const boxes = pvBody.querySelectorAll('input[type="checkbox"]');
  if (boxes.length) {
    const lines = text.split('\n');
    for (const blk of pvBody.children) {
      const bs = blk.querySelectorAll('input[type="checkbox"]');
      if (!bs.length) continue;
      let count = 0;
      for (let i = blk._line; i < blk._line + blk._n; i++) if (TASK_RE.test(lines[i] || '')) count++;
      if (count === bs.length) bs.forEach((b, k) => { b.disabled = false; b._k = k; });
    }
  }
  // code highlighting + mermaid placeholders
  const diagrams = [];
  for (const code of pvBody.querySelectorAll('pre > code')) {
    const lang = (/(?:^|\s)language-(\S+)/.exec(code.className) || [])[1];
    if (!lang) continue;
    if (lang === 'mermaid') {
      const box = document.createElement('div');
      box.className = 'mmd'; box._src = code.textContent;
      const cached = mermaidCache.get(box._src);
      if (cached) box.innerHTML = cached; else { box.classList.add('wait'); box.textContent = 'Rendering diagram…'; diagrams.push(box); }
      code.parentNode.replaceWith(box);
    } else if (loadLib('lib-hljs') && self.hljs && hljs.getLanguage(lang)) {
      try { code.innerHTML = hljs.highlight(code.textContent, { language: lang, ignoreIllegals: true }).value; code.classList.add('hljs'); } catch (e) {}
    }
  }
  // math
  const maths = pvBody.querySelectorAll('.math');
  if (maths.length && loadKatex() && self.katex) {
    for (const el of maths) {
      try { katex.render(el.textContent, el, { displayMode: el.classList.contains('math-d'), throwOnError: false }); } catch (e) {}
    }
  }
  if (diagrams.length) setTimeout(() => renderDiagrams(diagrams), 30);
}

async function renderDiagrams(boxes) {
  const ok = loadLib('lib-mermaid') && self.mermaid;
  if (ok && !renderDiagrams.init) {
    renderDiagrams.init = true;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' });
  }
  for (const box of boxes) {
    box.classList.remove('wait');
    if (!ok) { box.classList.add('err'); box.textContent = 'Diagram support failed to load.\n\n' + box._src; continue; }
    const id = 'mmd' + (++mermaidSeq);
    try {
      const { svg } = await mermaid.render(id, box._src);
      mermaidCache.set(box._src, svg);
      box.innerHTML = svg;
    } catch (e) {
      box.classList.add('err');
      box.textContent = 'Diagram error: ' + (e && e.message || e) + '\n\n' + box._src;
    }
    document.querySelectorAll('#' + id + ', #d' + id).forEach(n => { if (!box.contains(n)) n.remove(); });
  }
  // diagrams changed heights: keep the anchored line in place unless the user already scrolled
  if (st.view === 'preview' && Math.abs(pv.scrollTop - pvAnchorTop) < 3) pvScrollToLine(st.line);
}

/* ------------------------------------------- line <-> pixel position maps */
function withMirror(fn) {
  const lines = ta.value.split('\n');
  mirror.style.width = ta.clientWidth + 'px';
  const frag = document.createDocumentFragment();
  for (const l of lines) { const d = document.createElement('div'); d.textContent = l || '​'; frag.appendChild(d); }
  mirror.replaceChildren(frag);
  try { return fn(mirror.children); } finally { mirror.replaceChildren(); }
}
function edTopLine() {
  if (ta.scrollTop <= 1) return 0;
  return withMirror(ch => {
    const y = ta.scrollTop + 2;
    let lo = 0, hi = ch.length - 1;                    // first line whose top is at/below the view top
    while (lo < hi) { const m = (lo + hi) >> 1; if (ch[m].offsetTop >= y) hi = m; else lo = m + 1; }
    return lo;
  });
}
function edScrollToLine(line) {
  if (line <= 0) { ta.scrollTop = 0; return; }
  withMirror(ch => { ta.scrollTop = Math.max(0, ch[clamp(line, 0, ch.length - 1)].offsetTop - TOP_GAP); });
}
function pvTopLine() {
  if (pv.scrollTop <= 1) return 0;
  const y = pv.scrollTop + TOP_GAP;
  for (const b of pvBody.children) {
    if (b._line === undefined) continue;
    if (b.offsetTop + b.offsetHeight > y + 2) {
      const frac = clamp((y - b.offsetTop) / Math.max(1, b.offsetHeight), 0, 1);
      return b._line + Math.min(b._n - 1, Math.round(frac * b._n));
    }
  }
  return st.line;
}
function pvScrollToLine(line) {
  let target = null;
  for (const b of pvBody.children) { if (b._line === undefined) continue; if (b._line <= line || !target) target = b; else break; }
  let top = 0;
  if (target && line > 0) {
    const frac = clamp((line - target._line) / target._n, 0, 1);
    top = Math.max(0, target.offsetTop + frac * target.offsetHeight - TOP_GAP);
  }
  pv.scrollTop = top;
  pvAnchorTop = pv.scrollTop;
}

/* ------------------------------------------------------------------ views */
function buildToc() {
  const hs = st.headings.filter(h => h.level <= 3);
  const frag = document.createDocumentFragment();
  if (!hs.length) {
    const p = document.createElement('p'); p.className = 'empty';
    p.textContent = 'No headers yet. Lines starting with #, ## or ### show up here.';
    frag.appendChild(p);
  } else {
    let cur = -1;
    hs.forEach((h, i) => { if (h.line <= st.line + 1) cur = i; });
    const min = Math.min(...hs.map(h => h.level));
    hs.forEach((h, i) => {
      const b = document.createElement('button');
      b.className = 'l' + (h.level - min + 1) + (i === cur ? ' cur' : '');
      b.textContent = h.text || '(empty header)';
      b._line = h.line;
      frag.appendChild(b);
    });
    const hint = document.createElement('div'); hint.className = 'hint';
    hint.textContent = 'Tap: open in Preview · Double-tap: open in Edit';
    frag.appendChild(hint);
  }
  tocEl.replaceChildren(frag);
  const c = tocEl.querySelector('.cur');
  tocEl.scrollTop = c ? Math.max(0, c.offsetTop - tocEl.clientHeight / 3) : 0;
}

function show(view, keepLine) {
  if (!keepLine && view !== st.view) {
    if (st.view === 'edit') st.line = edTopLine();
    else if (st.view === 'preview') st.line = pvTopLine();
  }
  if (view !== 'edit') { render(); ta.blur(); }
  st.view = view;
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-selected', b.dataset.view === view);
  ta.classList.toggle('on', view === 'edit');
  pv.classList.toggle('on', view === 'preview');
  tocEl.classList.toggle('on', view === 'toc');
  if (view === 'edit') edScrollToLine(st.line);
  else if (view === 'preview') pvScrollToLine(st.line);
  else buildToc();
  const sel = getSelection(); if (sel && view !== 'edit') sel.removeAllRanges();
  saveDraftSoon();
}

function lineStartPos(line) {
  const v = ta.value; let pos = 0;
  for (let i = 0; i < line; i++) { const j = v.indexOf('\n', pos); if (j < 0) break; pos = j + 1; }
  return pos;
}
function goEdit(line) {
  st.line = line;
  const pos = lineStartPos(line);
  try { ta.setSelectionRange(pos, pos); } catch (e) {}
  show('edit', true);
}
function goPreview(line) { st.line = line; show('preview', true); }

/* double-tap / double-click detection that works for touch and mouse */
let lastDouble = -1e9;         // shared, so one physical double-tap can never trigger two jumps
function onDoubleTap(el, handler) {
  let down = null, last = null;
  const fire = e => { if (performance.now() - lastDouble < 400) return; lastDouble = performance.now(); handler(e); };
  el.addEventListener('pointerdown', e => { if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: e.timeStamp }; });
  el.addEventListener('pointerup', e => {
    if (!down || !e.isPrimary) return;
    const tap = e.timeStamp - down.t < 350 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12;
    down = null;
    if (!tap) { last = null; return; }
    if (last && e.timeStamp - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) { last = null; fire(e); }
    else last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });
  el.addEventListener('dblclick', fire);
}

// Edit: double-tap on a header line -> Preview at that header
onDoubleTap(ta, () => setTimeout(() => {
  if (st.view !== 'edit') return;
  const v = ta.value, pos = ta.selectionStart;
  let line = 0; for (let i = v.indexOf('\n'); i >= 0 && i < pos; i = v.indexOf('\n', i + 1)) line++;
  const lines = v.split('\n');
  const atx = /^ {0,3}#{1,6}(?:\s|$)/, under = /^ {0,3}(?:=+|-+)\s*$/;
  if (!atx.test(lines[line]) && !under.test(lines[line]) && !under.test(lines[line + 1] || '')) return;
  render();
  const h = st.headings.find(h => h.line <= line && line < h.line + h.n);
  if (h) goPreview(h.line);
}, 60));

// Preview: double-tap on a header -> Edit at that header
onDoubleTap(pv, e => {
  const h = e.target.closest && e.target.closest('h1,h2,h3,h4,h5,h6');
  const blk = h && h.closest('.blk');
  if (blk && blk._line !== undefined && pvBody.contains(blk)) goEdit(blk._line);
});

// Preview: in-page links and task checkboxes
pv.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  let id; try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch (err) { return; }
  const h = st.headings.find(h => slug(h.text) === id.toLowerCase());
  if (h) { st.line = h.line; pvScrollToLine(h.line); }
});
pv.addEventListener('change', e => {
  const box = e.target;
  if (!box.matches || !box.matches('input[type="checkbox"]') || box._k === undefined) return;
  const blk = box.closest('.blk'); if (!blk) return;
  const lines = ta.value.split('\n');
  let k = -1;
  for (let i = blk._line; i < blk._line + blk._n; i++) {
    if (TASK_RE.test(lines[i] || '') && ++k === box._k) {
      lines[i] = lines[i].replace(TASK_RE, (m, pre) => pre + (box.checked ? '[x]' : '[ ]'));
      ta.value = lines.join('\n');
      st.rendered = ta.value;
      setDirty(true);
      return;
    }
  }
});

// TOC: tap -> Preview, double-tap -> Edit
let tocTimer = 0, tocBtn = null;
tocEl.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('button');
  if (!b || b._line === undefined) return;
  if (tocTimer && tocBtn === b) { clearTimeout(tocTimer); tocTimer = 0; goEdit(b._line); return; }
  clearTimeout(tocTimer); tocBtn = b;
  tocTimer = setTimeout(() => { tocTimer = 0; goPreview(b._line); }, 300);
});

document.querySelector('.seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (b && b.dataset.view !== st.view) show(b.dataset.view);
});

ta.addEventListener('input', () => { if (!st.dirty) setDirty(true); else saveDraftSoon(); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });
addEventListener('pagehide', saveDraft);

/* ---------------------------------------------------------- recent files */
// Each entry: {name, ts, text (snapshot, may be null), handle (when the browser gives one)}
const MAX_RECENTS = 20;
let recents = [];
async function loadRecents() {
  let r = await idbGet('recents');
  if (!Array.isArray(r)) { try { r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { r = []; } }
  recents = Array.isArray(r) ? r : [];
}
async function addRecent(name, text, handle) {
  const keep = [];
  for (const r of recents) {
    let same = r.name === name;
    if (same && handle && r.handle && r.handle.isSameEntry) { try { same = await r.handle.isSameEntry(handle); } catch (e) {} }
    if (!same) keep.push(r);
  }
  recents = [{ name, ts: Date.now(), text: text.length <= 1048576 ? text : null, handle: handle || null }, ...keep].slice(0, MAX_RECENTS);
  idbSet('recents', recents);
  // the fallback copy shares limited storage with the draft, so only the newest snapshots keep their text
  let budget = 1500000;
  const plain = recents.map(r => { const keepText = r.text != null && (budget -= r.text.length) >= 0; return { name: r.name, ts: r.ts, text: keepText ? r.text : null }; });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(plain)); }
  catch (e) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(plain.map(r => ({ ...r, text: null })))); } catch (e2) {} }
}
function renderRecents() {
  const box = $('recent');
  const list = recents.filter(r => r.name !== st.name && (r.handle || r.text != null));
  box.replaceChildren();
  box.hidden = !list.length;
  if (!list.length) return;
  const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = 'Recent'; box.appendChild(lbl);
  for (const r of list) {
    const b = document.createElement('button'); b.setAttribute('role', 'menuitem');
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/></svg>';
    const sp = document.createElement('span'); sp.textContent = r.name; b.appendChild(sp);
    b._recent = r; box.appendChild(b);
  }
  // show as many as fit on screen without pushing the file operations out of view
  while (menu.scrollHeight > menu.clientHeight + 1 && box.lastElementChild && box.lastElementChild !== lbl) box.lastElementChild.remove();
  if (box.lastElementChild === lbl) { box.replaceChildren(); box.hidden = true; }
}
async function openRecent(r) {
  if (!await confirmDiscard('open "' + r.name + '"')) return;
  if (r.handle) {
    try {
      if (r.handle.queryPermission && await r.handle.queryPermission({ mode: 'read' }) !== 'granted') await r.handle.requestPermission({ mode: 'read' });
      await readFile(await r.handle.getFile(), r.handle);
      return;
    } catch (e) { if (isAbort(e)) return; console.warn(e); }
  }
  if (r.text == null) { toast('Could not open ' + r.name + ' – use Open… instead'); return; }
  openDoc(r.text, r.name, null);
  addRecent(r.name, r.text, null);
  toast('Opened the last saved copy of ' + r.name);
}

/* ------------------------------------------------------------- file menu */
function openMenu(open) {
  menu.hidden = scrim.hidden = !open;
  if (open) renderRecents();          // after showing, so it can measure what fits
  menuBtn.setAttribute('aria-expanded', open);
}
menuBtn.addEventListener('click', () => openMenu(menu.hidden));
scrim.addEventListener('click', () => openMenu(false));
menu.addEventListener('click', e => {
  const rb = e.target.closest('#recent button');
  if (rb && rb._recent) { openMenu(false); openRecent(rb._recent).catch(err => { console.error(err); toast('Could not open file'); }); return; }
  const b = e.target.closest('button[data-act]'); if (!b) return;
  openMenu(false);
  actions[b.dataset.act]().catch(err => { console.error(err); toast('Something went wrong: ' + (err && err.message || err)); });
});

function setDoc(text, name, handle) {
  ta.value = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  st.name = name || DEFAULT_NAME; st.handle = handle || null; st.rendered = null; st.line = 0;
  idbSet('handle', st.handle);
  try { ta.setSelectionRange(0, 0); } catch (e) {}
  show(st.view, true);
  setDirty(false); saveDraft();
}

// a file that was just opened starts on its table of contents (or Preview when it has no headers)
function openDoc(text, name, handle) {
  setDoc(text, name, handle);
  render();
  show(st.headings.some(h => h.level <= 3) ? 'toc' : 'preview', true);
}

async function readFile(file, handle) {
  if (file.size > 20 * 1024 * 1024) { toast('That file is too large to edit here'); return; }
  openDoc(await file.text(), file.name, handle);
  addRecent(st.name, ta.value, handle);
  toast('Opened ' + file.name);
}

function suggestedName() {
  if (st.name !== DEFAULT_NAME) return st.name;
  render();
  const h = st.headings[0];
  const base = h ? h.text.replace(/[\\/:*?"<>|#]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 60) : '';
  return (base || 'untitled') + '.md';
}

async function writeHandle(handle) {
  if (handle.queryPermission && await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new DOMException('Permission denied', 'NotAllowedError');
  }
  const w = await handle.createWritable();
  await w.write(ta.value);
  await w.close();
}

function download(name) {
  const url = URL.createObjectURL(new Blob([ta.value], { type: 'text/markdown' }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const actions = {
  async new() {
    if (!await confirmDiscard('start a new file')) return;
    st.view = 'edit';
    setDoc('', DEFAULT_NAME, null);
    ta.focus();
  },

  async open() {
    if (!await confirmDiscard('open another file')) return;
    if (window.showOpenFilePicker) {
      try {
        const [h] = await showOpenFilePicker({ multiple: false });
        await readFile(await h.getFile(), h);
        return;
      } catch (e) { if (isAbort(e)) return; console.warn(e); }
    }
    const inp = $('filePick'); inp.value = ''; inp.click();
  },

  async save() {
    if (st.handle) {
      try { await writeHandle(st.handle); setDirty(false); addRecent(st.name, ta.value, st.handle); toast('Saved ' + st.name); return; }
      catch (e) { if (isAbort(e)) return; console.warn(e); toast('Could not write to the original location – choose where to save'); }
    }
    return actions.saveas();
  },

  async saveas() {
    const name = suggestedName();
    if (window.showSaveFilePicker) {
      let h;
      try {
        try { h = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }] }); }
        catch (e) { if (e.name !== 'TypeError') throw e; h = await showSaveFilePicker({ suggestedName: name }); }
        await writeHandle(h);
        st.handle = h; st.name = h.name; idbSet('handle', h);
        setDirty(false); saveDraft(); addRecent(st.name, ta.value, h); toast('Saved ' + st.name);
        return;
      } catch (e) { if (isAbort(e)) return; console.warn(e); }
    }
    download(name);
    st.name = name; setDirty(false); addRecent(name, ta.value, null);
    toast('Saved a copy to Downloads (saving in place is not supported in this browser mode)', 4200);
  },

  async install() {
    if (!installEvt) return;
    installEvt.prompt(); await installEvt.userChoice; installEvt = null;
    menu.querySelector('[data-act="install"]').hidden = true;
  },
};

$('filePick').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) readFile(f, null).catch(err => toast('Could not read file: ' + err.message));
});

addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); actions.save().catch(console.error); }
  if (e.key === 'Escape' && !menu.hidden) openMenu(false);
});

let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; menu.querySelector('[data-act="install"]').hidden = false; });
addEventListener('appinstalled', () => { installEvt = null; menu.querySelector('[data-act="install"]').hidden = true; });

/* ---------------------------------------------------------------- startup */
async function receiveShared() {
  // a file shared to the installed app arrives through the service worker (see sw.js)
  if (!/[?&]shared=1/.test(location.search)) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('mded-share');
    const res = await cache.match('shared-file');
    if (!res) return;
    const name = decodeURIComponent(res.headers.get('X-File-Name') || '') || DEFAULT_NAME;
    const text = await res.text();
    await cache.delete('shared-file');
    if (!await confirmDiscard('open the shared file')) return;
    openDoc(text, name, null); setDirty(true);
    toast('Received ' + name);
  } catch (e) { console.warn(e); }
}

(async function init() {
  const d = loadDraft();
  if (d && typeof d.text === 'string') {
    ta.value = d.text; st.name = d.name || DEFAULT_NAME; st.dirty = !!d.dirty; st.line = d.line || 0;
    try { ta.setSelectionRange(d.sel || 0, d.sel || 0); } catch (e) {}
    const view = ['edit', 'preview', 'toc'].includes(d.view) ? d.view : 'edit';
    show(view, true);
    if (view === 'edit' && d.edScroll) ta.scrollTop = d.edScroll;
    if (d.hasHandle) idbGet('handle').then(h => { if (h && !st.handle) { st.handle = h; updateUi(); } });
  }
  updateUi();
  loadRecents();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e));
  }
  if ('launchQueue' in window) {
    launchQueue.setConsumer(async p => {
      if (!p.files || !p.files.length) return;
      if (!await confirmDiscard('open this file')) return;
      const h = p.files[0]; readFile(await h.getFile(), h);
    });
  }
  receiveShared();
})();

})();
