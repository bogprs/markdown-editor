<p align="center">
  <img src="icons/icon.svg" width="120" alt="Markdown Editor logo">
</p>

# Markdown Editor

A small, offline Markdown editor made for Android phones and Chrome.

It is meant for reading and editing `.md` files on a phone without an account, a server or a heavy app: notes, to-do lists, documentation, drafts. Your files stay where they are – on the phone or in a cloud folder such as Google Drive – and the editor only opens and saves them through Android's own file picker.

**Open it here: https://bogprs.github.io/markdown-editor/**

## Install as an app

1. On your Android phone, open **https://bogprs.github.io/markdown-editor/** in Chrome.
2. Open the menu (☰, top right) and tap **Install app**, or use Chrome's ⋮ menu → **Add to Home screen** → **Install**.

The editor then sits on your home screen with its own icon, opens full-screen and works without an internet connection.

## How it works

The top of the screen has three view buttons and a menu:

| | |
|---|---|
| **TOC** | Table of contents built from the headers in the file, three levels deep. |
| **Edit** | The Markdown source, edited with the normal Android keyboard. |
| **Preview** | The formatted document. |
| **☰** | File menu: current file, recent files, New, Open, Save, Save as. |

### A typical session

1. **Open a file** from the menu. Android's file picker lets you choose from local storage or a connected cloud provider. The file opens on its **TOC**, so you see its structure first.
2. **Tap a header** in the TOC to read that section in **Preview**, or **double-tap** it to go straight to **Edit** at that spot.
3. **Double-tap a header** while reading in Preview to edit that section; double-tap a header in Edit to see the result in Preview. The header lands at the top of the screen with its text below, so you never lose your place.
4. **Save** from the menu. The first time you choose a location with **Save as**; after that, Save writes to the same file.

Switching views with the top buttons also keeps your position in the text.

### Starting from scratch

Choose **New** and start typing. Everything you write is kept as a draft automatically, so closing the browser or the app does not lose it. The draft is there when you come back, until you save it or start another file. A dot on the menu button means there are unsaved changes.

### Recent files

The menu lists the three files you opened or saved most recently. Tap one to open it again.

### What Preview understands

- GitHub-style Markdown: headers, lists, tables, links, images, quotes, code blocks
- Task lists – tap a checkbox in Preview and the `- [ ]` in the file is updated
- Syntax highlighting in fenced code blocks
- Math written as `$...$` or `$$...$$`
- Mermaid diagrams in <code>```mermaid</code> blocks

## Using it as a single file

The whole editor is one self-contained file, [`index.html`](index.html). You can copy it to a phone and open it in Chrome without installing anything.

Chrome restricts pages opened this way, so some things work differently: there is no home-screen icon, Save may download a copy instead of writing to the location you chose, and drafts may not be kept. The installed app does not have these limits.

## Privacy

The editor runs entirely in your browser. Files and drafts are not uploaded anywhere; the only network requests are loading the app itself and any remote images a document links to.

## Development

The app code lives in `src/`; `index.html` is generated from it together with the libraries listed in `package.json`.

```
npm install
npm run build      # writes index.html
```

`node build.mjs --icons` also redraws the PNG icons from the logo and needs Playwright with Chromium available.

| Path | Purpose |
|---|---|
| `src/app.js`, `src/app.css`, `src/template.html` | Application source |
| `build.mjs` | Builds `index.html` and the icons |
| `manifest.webmanifest`, `sw.js`, `icons/` | What makes the page installable and usable offline |
