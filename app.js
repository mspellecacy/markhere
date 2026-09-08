/* markhere — a dead-simple markdown scratch pad.
 *
 * Philosophy (inherited from typehere.co): the page is a blank surface you can
 * type on instantly, and it NEVER loses your text. Every keystroke is persisted
 * to localStorage synchronously, so a crash/close/reopen loses nothing.
 *
 * No framework, no build step. Open index.html and it works, online or off.
 */

(() => {
  "use strict";

  const KEY = "markhere:v1";
  const $ = (sel) => document.querySelector(sel);

  const el = {
    body: document.body,
    editor: $("#editor"),
    preview: $("#preview"),
    list: $("#pad-list"),
    sidebar: $("#sidebar"),
    counter: $("#counter"),
    storageNote: $("#storage-note"),
    fontBtn: $("#toggle-font"),
    fontMenu: $("#font-menu"),
    widthBtn: $("#toggle-width"),
  };

  // Selectable editor faces. Serif + mono are system fonts (instant, no download);
  // OpenDyslexic is vendored under vendor/fonts. Add more here to extend the menu.
  const FONTS = [
    { id: "serif", label: "Serif" },
    { id: "mono", label: "Mono" },
    { id: "dyslexic", label: "OpenDyslexic" },
  ];

  // marked: GitHub-flavored, single-newline => <br>. We render our own text into
  // our own page, so raw HTML is allowed for now. (When sync/sharing lands,
  // sanitize with DOMPurify before this becomes multi-author content.)
  marked.setOptions({ gfm: true, breaks: true });

  /** @typedef {{id:string, content:string, createdAt:number, updatedAt:number}} Pad */

  /** @type {{version:number, pads:Pad[], activeId:string|null, mode:string, theme:string|null}} */
  let state;

  // ---- Persistence -------------------------------------------------------
  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch { /* corrupt payload — start fresh rather than lose the app */ }

    if (saved && Array.isArray(saved.pads) && saved.pads.length) {
      state = saved;
    } else {
      state = { version: 1, pads: [], activeId: null, mode: "edit", theme: null, font: "serif", previewWide: false };
      state.pads.push(newPad());
      state.activeId = state.pads[0].id;
    }
    if (!state.pads.some((p) => p.id === state.activeId)) {
      state.activeId = state.pads[0].id;
    }
    state.mode = state.mode || "edit";
    // Migrate older saves that predate the font picker.
    if (!FONTS.some((f) => f.id === state.font)) state.font = "serif";
    state.previewWide = !!state.previewWide; // predates the preview-width toggle
  }

  // Synchronous write on every keystroke — the whole point of the app.
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      markSaved(true);
    } catch (e) {
      // Quota exceeded or storage disabled (private mode). Warn, don't crash.
      markSaved(false, e);
    }
  }

  let saveOk = true;
  function markSaved(ok, err) {
    if (ok === saveOk) return;
    saveOk = ok;
    el.storageNote.textContent = ok
      ? "Saved locally"
      : "⚠ Could not save — storage full or blocked";
    if (!ok && err) console.warn("markhere persist failed:", err);
  }

  // ---- Model helpers -----------------------------------------------------
  function newPad() {
    const now = Date.now();
    return { id: crypto.randomUUID(), content: "", createdAt: now, updatedAt: now };
  }

  function activePad() {
    return state.pads.find((p) => p.id === state.activeId);
  }

  function titleOf(pad) {
    const firstLine = (pad.content.split("\n").find((l) => l.trim()) || "").trim();
    return firstLine.replace(/^#+\s*/, "").slice(0, 60);
  }

  // ---- Rendering ---------------------------------------------------------
  function renderList() {
    el.list.innerHTML = "";
    // Most-recently-edited first.
    const pads = [...state.pads].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const pad of pads) {
      const li = document.createElement("li");
      li.dataset.id = pad.id;
      if (pad.id === state.activeId) li.classList.add("active");

      const title = document.createElement("span");
      const t = titleOf(pad);
      title.className = "pad-title" + (t ? "" : " empty");
      title.textContent = t || "Untitled";
      li.appendChild(title);

      const del = document.createElement("button");
      del.className = "pad-del";
      del.textContent = "✕";
      del.title = "Delete pad";
      del.setAttribute("aria-label", "Delete pad");
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deletePad(pad.id);
      });
      li.appendChild(del);

      li.addEventListener("click", () => switchTo(pad.id));
      el.list.appendChild(li);
    }
  }

  // GitHub-style heading slug, so in-page anchors like [x](#heading-text) resolve.
  // (marked v12 no longer emits heading ids, so we add them after render.)
  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/<[^>]*>/g, "")            // drop any inline HTML tags
      .replace(/[^\p{L}\p{N}\s-]/gu, "")  // keep letters, numbers, spaces, hyphens
      .replace(/\s/g, "-");               // spaces -> hyphens
  }

  function addHeadingIds(container) {
    const seen = Object.create(null);
    container.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      if (h.id) return; // keep an explicit id authored in the note's raw HTML
      const base = slugify(h.textContent) || "section";
      let slug = base, n = 0;
      while (seen[slug]) slug = `${base}-${++n}`; // dedupe: foo, foo-1, foo-2 (GitHub-compatible)
      seen[slug] = true;
      h.id = slug;
    });
  }

  function renderPreview() {
    if (state.mode === "edit") return;
    el.preview.innerHTML = marked.parse(activePad().content || "");
    addHeadingIds(el.preview);
    // Syntax-highlight fenced code blocks (Prism, loaded in manual mode).
    if (window.Prism) Prism.highlightAllUnder(el.preview);
  }

  // In-page anchor clicks (e.g. a table of contents) scroll within the preview.
  function onPreviewClick(e) {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent((a.getAttribute("href") || "").slice(1));
    if (!id) return;
    const target = el.preview.querySelector("#" + CSS.escape(id));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // No matching target (e.g. this file's hand-written #html anchors) → do nothing.
  }

  function renderCounter() {
    const text = activePad().content;
    const words = (text.match(/\S+/g) || []).length;
    el.counter.textContent = `${words} word${words === 1 ? "" : "s"}`;
  }

  function applyMode() {
    el.body.dataset.mode = state.mode;
    const showPreview = state.mode !== "edit";
    const showEditor = state.mode !== "preview";
    el.preview.hidden = !showPreview;
    el.editor.hidden = !showEditor;
    if (showPreview) renderPreview();
  }

  function applyTheme() {
    if (state.theme) document.documentElement.dataset.theme = state.theme;
    else delete document.documentElement.dataset.theme; // fall back to system
  }

  function applyFont() {
    document.documentElement.dataset.font = state.font;
    renderFontMenu();
  }

  // Preview width: default is the fixed reading column; toggle to full width.
  // Only affects preview-only mode (split view stays 50/50, edit has no preview).
  function applyPreviewWidth() {
    if (state.previewWide) document.documentElement.dataset.preview = "wide";
    else delete document.documentElement.dataset.preview;
    el.widthBtn.setAttribute("aria-pressed", String(state.previewWide));
  }
  function togglePreviewWidth() {
    state.previewWide = !state.previewWide;
    applyPreviewWidth();
    persist();
  }

  function renderFontMenu() {
    el.fontMenu.innerHTML = "";
    for (const f of FONTS) {
      const li = document.createElement("li");
      li.dataset.font = f.id;
      li.setAttribute("role", "menuitemradio");
      li.setAttribute("aria-checked", String(state.font === f.id));
      const label = document.createElement("span");
      label.className = "opt-label";
      label.textContent = f.label; // shown in its own face, so you preview before choosing
      li.appendChild(label);
      li.addEventListener("click", () => selectFont(f.id));
      el.fontMenu.appendChild(li);
    }
  }

  function selectFont(id) {
    state.font = id;
    applyFont();
    persist();
    closeFontMenu();
    if (state.mode !== "preview") el.editor.focus();
  }

  function openFontMenu() {
    el.fontMenu.hidden = false;
    el.fontBtn.setAttribute("aria-expanded", "true");
    // Capture so a click anywhere else closes the menu (added after this click).
    document.addEventListener("click", onOutsideMenuClick, true);
  }
  function closeFontMenu() {
    if (el.fontMenu.hidden) return;
    el.fontMenu.hidden = true;
    el.fontBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutsideMenuClick, true);
  }
  function toggleFontMenu() {
    el.fontMenu.hidden ? openFontMenu() : closeFontMenu();
  }
  function onOutsideMenuClick(e) {
    if (!e.target.closest("#toggle-font") && !e.target.closest("#font-menu")) closeFontMenu();
  }

  // ---- Actions -----------------------------------------------------------
  function switchTo(id) {
    state.activeId = id;
    el.editor.value = activePad().content;
    renderList();
    renderCounter();
    if (state.mode !== "preview") el.editor.focus();
    applyMode();
    persist();
  }

  function createPad() {
    const pad = newPad();
    state.pads.push(pad);
    switchTo(pad.id);
  }

  function deletePad(id) {
    const pad = state.pads.find((p) => p.id === id);
    if (pad && pad.content.trim() && !confirm(`Delete "${titleOf(pad) || "Untitled"}"?`)) return;
    state.pads = state.pads.filter((p) => p.id !== id);
    if (!state.pads.length) state.pads.push(newPad());
    if (id === state.activeId) state.activeId = state.pads[0].id;
    el.editor.value = activePad().content;
    renderList();
    renderCounter();
    applyMode();
    persist();
  }

  function onInput() {
    const pad = activePad();
    pad.content = el.editor.value;
    pad.updatedAt = Date.now();
    persist();          // every keystroke — lose nothing
    renderCounter();
    if (state.mode !== "edit") renderPreview();
    scheduleTitleRefresh();
  }

  // The pad list only needs to re-sort/re-title occasionally, not per keystroke.
  let titleTimer = null;
  function scheduleTitleRefresh() {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(renderList, 400);
  }

  function toggleSidebar(force) {
    const open = force ?? !el.body.classList.contains("sidebar-open");
    el.sidebar.hidden = !open;
    el.body.classList.toggle("sidebar-open", open);
  }

  function cycleMode() {
    state.mode = { edit: "split", split: "preview", preview: "edit" }[state.mode];
    applyMode();
    persist();
  }

  function toggleTheme() {
    const sysDark = matchMedia("(prefers-color-scheme: dark)").matches;
    const current = state.theme || (sysDark ? "dark" : "light");
    state.theme = current === "dark" ? "light" : "dark";
    applyTheme();
    persist();
  }

  // ---- Wiring ------------------------------------------------------------
  function bind() {
    el.editor.addEventListener("input", onInput);
    el.preview.addEventListener("click", onPreviewClick);

    $("#new-pad").addEventListener("click", createPad);
    $("#toggle-sidebar").addEventListener("click", () => toggleSidebar());
    $("#toggle-mode").addEventListener("click", cycleMode);
    $("#toggle-theme").addEventListener("click", toggleTheme);
    el.widthBtn.addEventListener("click", togglePreviewWidth);
    el.fontBtn.addEventListener("click", toggleFontMenu);

    // Keep textarea and preview scroll roughly in sync in split view.
    el.editor.addEventListener("scroll", () => {
      if (state.mode !== "split") return;
      const ratio = el.editor.scrollTop / (el.editor.scrollHeight - el.editor.clientHeight || 1);
      el.preview.scrollTop = ratio * (el.preview.scrollHeight - el.preview.clientHeight);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeFontMenu(); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "n") { e.preventDefault(); createPad(); }
      else if (e.key === "/") { e.preventDefault(); cycleMode(); }
      else if (e.key === "\\") { e.preventDefault(); toggleSidebar(); }
      else if (e.key === "j") { e.preventDefault(); toggleTheme(); }
    });

    // Tab inserts a tab instead of leaving the editor.
    el.editor.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      e.preventDefault();
      const s = el.editor.selectionStart, en = el.editor.selectionEnd;
      el.editor.setRangeText("\t", s, en, "end");
      onInput();
    });
  }

  // ---- Boot --------------------------------------------------------------
  load();
  applyTheme();
  applyFont();
  applyPreviewWidth();
  bind();
  el.editor.value = activePad().content;
  renderList();
  renderCounter();
  applyMode();
  if (state.mode !== "preview") el.editor.focus();
  markSaved(true);
  el.storageNote.textContent = "Saved locally";

  // Register the service worker so the app shell works offline once visited.
  // (Requires HTTPS or localhost; silently skipped on file://.)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("markhere: service worker registration failed:", err);
      });
    });
  }
})();
