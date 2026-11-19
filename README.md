# Markdown Editor

A small offline Markdown editor for Android browsers (Chrome). One self-contained `index.html`, which also works as an installable PWA when served over HTTPS.

- **TOC / Edit / Preview** buttons on top; the file menu (New, Open, Save, Save as, recent files) is behind the hamburger icon.
- Double-tap a header in Edit to open Preview at that header, and the other way round. In TOC, tap opens Preview and double-tap opens Edit.
- Drafts are kept automatically; Save writes back to the location chosen in Save as (where the browser supports it, otherwise a copy is downloaded).
- Preview: GitHub-style Markdown, tappable task checkboxes, code highlighting, LaTeX math (`$..$`, `$$..$$`) and Mermaid diagrams.

## Use

**Recommended – install it as an app:**

1. On your Android phone, open **https://bogprs.github.io/markdown-editor/** in Chrome.
2. Open the app's menu (hamburger icon) and tap **Install app**, or use Chrome's ⋮ menu → **Add to Home screen** → **Install**.

The editor then sits on your home screen with its own icon, opens full-screen and works offline. Saving back to the same file works best in this mode.

**Alternative – as a single file:** copy `index.html` to the phone and open it in Chrome. No install is needed, but Chrome restricts local files: there is no home-screen icon, and Save may download a copy instead of writing to the chosen location.

## Build

```
npm install
npm run build      # writes index.html from src/ and the npm libraries
```

The app code lives in `src/`; `index.html` is generated, so edit the sources and rebuild. `node build.mjs --icons` also redraws the PNG icons and needs Playwright with Chromium available.
