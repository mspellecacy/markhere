# markhere

A dead-simple, local-first **markdown scratch pad**. Open it and type — every
keystroke is saved to your browser's `localStorage`, so closing or crashing the
tab loses nothing. Inspired by the much-missed [typehere.co](https://typehere.co).

- **Zero build, zero framework, zero backend.** Just static files.
- **Works offline** — the markdown renderer and fonts are vendored locally.
- **Multiple pads**, a live markdown preview (edit / split / preview), and a
  font picker (Serif, Mono, or the dyslexia-friendly OpenDyslexic).
- **Nothing leaves your machine.** Your notes live only in your browser.

## Run locally

It's static, so anything that serves a folder works:

```bash
python3 -m http.server 4321   # then open http://localhost:4321
```

Or just open `index.html` directly (`file://`) — it works too.

## Install as an app

markhere is a PWA. In a Chromium browser (or Safari on iOS via *Share → Add to
Home Screen*), use the install control in the address bar to add it as a
standalone app. A service worker caches the app shell, so once you've opened it
online it launches and runs **fully offline** — your notes live in the browser
either way.

## Storage: browser or a folder

By default every pad lives in your browser's `localStorage` — nothing leaves
your machine and it works in every browser, offline.

On **Chromium desktop** browsers (Chrome/Edge/Brave) you can instead point
markhere at a **folder** on disk (sidebar → *Use a folder…*). Each pad becomes a
real `.md` file named after its title, auto-renamed as the title changes;
creating, editing, and deleting pads read/write that flat folder (no
subfolders). On first setup you can copy your existing browser pads in. Switch
back anytime with *Use browser storage* — the folder's files and the browser's
pads are kept separate and untouched. Firefox, Safari, and mobile browsers don't
expose folder access, so they stay on `localStorage`.

## Keyboard shortcuts

| Shortcut            | Action                          |
| ------------------- | ------------------------------- |
| `Ctrl/Cmd + N`      | New pad                         |
| `Ctrl/Cmd + /`      | Cycle edit → split → preview    |
| `Ctrl/Cmd + \`      | Toggle the pad sidebar          |
| `Ctrl/Cmd + J`      | Toggle light / dark theme       |
| `Esc`               | Close the font menu             |
| `Tab`               | Insert a tab (stay in editor)   |

## Deploy

markhere is a pure static site — all asset paths are relative, so it works at a
domain root *or* a sub-path (e.g. `you.github.io/markhere/`).

### GitHub Pages (recommended for now)

A workflow at `.github/workflows/deploy.yml` publishes on every push to
`master`. After pushing, enable it once: **repo Settings → Pages → Build and
deployment → Source: GitHub Actions**.

### Netlify

No build command; publish directory is the repo root (`.`). Connect the repo in
the Netlify UI, or `netlify deploy --prod --dir .` with the CLI.

### Vercel

Zero-config static deploy: `vercel --prod` from the repo root, or connect the
repo in the Vercel dashboard.

> **When you add sync/login later,** Netlify or Vercel become the better home —
> you can host the static app and a serverless function/auth backend together,
> with no host migration.

## Tech

Vanilla HTML/CSS/JS. Vendored dependencies:

- [marked](https://github.com/markedjs/marked) — markdown parser (MIT).
- [Prism](https://prismjs.com/) — syntax highlighting (MIT); curated bundle:
  core + HTML/CSS/JS, TypeScript, Python, Bash, JSON, YAML, SQL, Rust, Go, C, C++,
  C#, Java, Kotlin, Swift, Ruby, PHP, Markdown.
- [OpenDyslexic](https://opendyslexic.org/) — © Abbie Gonzalez, SIL Open Font
  License 1.1. See [`vendor/fonts/OpenDyslexic-OFL.txt`](vendor/fonts/OpenDyslexic-OFL.txt).

A service worker (`sw.js`) plus a web manifest (`manifest.webmanifest`) make it
an installable, offline PWA. Icons live in `icons/` (SVG sources + rasterized PNGs).
