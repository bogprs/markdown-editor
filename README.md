# Markdown Editor

A small offline Markdown editor for Android browsers (Chrome). One self-contained `index.html`, which also works as an installable PWA when served over HTTPS.

- **Edit / Preview / TOC** buttons on top; the file menu (New, Open, Save, Save as, Share) is behind the three-dot icon.
- Double-tap a header in Edit to open Preview at that header, and the other way round. In TOC, tap opens Preview and double-tap opens Edit.
- Drafts are kept automatically; Save writes back to the location chosen in Save as (where the browser supports it, otherwise a copy is downloaded).
- Preview: GitHub-style Markdown, tappable task checkboxes, code highlighting, LaTeX math (`$..$`, `$$..$$`) and Mermaid diagrams.

## Use

- **As a file:** copy `index.html` to the phone and open it in Chrome.
- **As an app:** serve this folder over HTTPS (for example GitHub Pages), open it in Chrome and choose *Install app*.

## Build

```
npm install
npm run build      # writes index.html from src/ and the npm libraries
```
