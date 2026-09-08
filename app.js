/* markhere — a dead-simple markdown scratch pad.
 *
 * Philosophy (inherited from typehere.co): the page is a blank surface you can
 * type on instantly, and it NEVER loses your text.
 *
 * Storage has two backends:
 *   - "local"  (default): all pads live in one localStorage blob, written on
 *                every keystroke. Works in every browser, offline.
 *   - "folder" (opt-in, Chromium desktop only): each pad is a real .md file in
 *                a folder you pick (File System Access API). Flat, no subdirs.
 *                Filenames track the pad title (auto-renamed). Local pads are
 *                left untouched while you're in folder mode.
 *
 * No framework, no build step. Open index.html and it works, online or off.
 */

(() => {
  "use strict";

  const KEY = "markhere:v1";
  const $ = (sel) => document.querySelector(sel);
  const FS_SUPPORTED = typeof window.showDirectoryPicker === "function";

  const el = {
    body: document.body,
    editor: $("#editor"),
    preview: $("#preview"),
    list: $("#pad-list"),
    sidebar: $("#sidebar"),
    counter: $("#counter"),
    storageNote: $("#storage-note"),
    storageControls: $("#storage-controls"),
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

  // Lucide icons, inlined so stroke="currentColor" follows the theme (an <img>
  // data URI would render black regardless of light/dark).
  const ICON_FOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-folder"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
  const ICON_MONITOR = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-monitor"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>';
  const ICON_FOLDER_UP = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-folder-up"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="m9 13 3-3 3 3"/></svg>';

  // marked: GitHub-flavored, single-newline => <br>. We render our own text into
  // our own page, so raw HTML is allowed for now. (When sync/sharing lands,
  // sanitize with DOMPurify before this becomes multi-author content.)
  marked.setOptions({ gfm: true, breaks: true });

  /** @typedef {{id:string, content:string, createdAt:number, updatedAt:number}} Pad */

  let state;                   // persisted settings + LOCAL pads (the localStorage blob)
  let store;                   // active working set {pads, activeId}; === state in local mode
  let storageMode = "local";   // "local" | "folder"
  let rootHandle = null;       // the folder the user picked (navigation is bounded to it)
  let dirHandle = null;        // the CURRENT directory (root or a descendant of it)
  let pathStack = [];          // dir handles from root..current, for walking back up
  let subDirs = [];            // subdirectory names in the current directory
  let pendingHandle = null;    // a remembered folder awaiting a permission re-grant
  const fileNames = new Map(); // padId -> current on-disk filename (current directory)

  // ---- Persistence (local blob = settings + local pads) ------------------
  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch { /* corrupt payload — start fresh rather than lose the app */ }

    if (saved && Array.isArray(saved.pads) && saved.pads.length) {
      state = saved;
    } else {
      state = { version: 1, pads: [], activeId: null, mode: "edit", theme: null,
                font: "serif", previewWide: false, storageMode: "local" };
      state.pads.push(newPad());
      state.activeId = state.pads[0].id;
    }
    if (!state.pads.some((p) => p.id === state.activeId)) {
      state.activeId = state.pads[0].id;
    }
    state.mode = state.mode || "edit";
    if (!FONTS.some((f) => f.id === state.font)) state.font = "serif"; // predates font picker
    state.previewWide = !!state.previewWide;                           // predates width toggle
    state.storageMode = state.storageMode === "folder" ? "folder" : "local";

    store = state;        // boot in local mode; folder is restored asynchronously
    storageMode = "local";
  }

  // Synchronous write of the local blob. In folder mode this still persists
  // settings + the (frozen) local pads; folder pad content goes to files.
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
    if (!ok && err) console.warn("markhere save failed:", err);
    updateStorageUI();
  }

  // ---- Model helpers -----------------------------------------------------
  function newPad() {
    const now = Date.now();
    return { id: crypto.randomUUID(), content: "", createdAt: now, updatedAt: now };
  }

  function activePad() {
    return store.pads.find((p) => p.id === store.activeId);
  }

  function titleOf(pad) {
    const firstLine = (pad.content.split("\n").find((l) => l.trim()) || "").trim();
    return firstLine.replace(/^#+\s*/, "").slice(0, 60);
  }

  // ---- Rendering ---------------------------------------------------------
  // Reflect the active pad into the editor (empty folder → read-only + hint).
  function loadActiveIntoEditor() {
    const p = activePad();
    el.editor.value = p ? p.content : "";
    const emptyFolder = storageMode === "folder" && !p;
    el.editor.readOnly = emptyFolder;
    el.editor.placeholder = emptyFolder
      ? "No notes in this folder — press ＋ to add one"
      : "Just start typing…";
  }

  // A navigation row (up / into a subfolder) — an icon plus a label, no delete.
  function navRow(icon, label, handler, tip) {
    const li = document.createElement("li");
    li.className = "nav-item";
    li.title = tip || label;
    const ic = document.createElement("span");
    ic.className = "nav-icon";
    ic.innerHTML = icon;
    li.appendChild(ic);
    const name = document.createElement("span");
    name.className = "pad-title";
    name.textContent = label;
    li.appendChild(name);
    li.addEventListener("click", handler);
    return li;
  }

  function renderList() {
    el.list.innerHTML = "";
    // Folder mode: one level of directory navigation (walk up / into subfolders).
    // Deliberately not a tree — just the current directory's folders and files.
    if (storageMode === "folder") {
      if (pathStack.length > 1) el.list.appendChild(navRow(ICON_FOLDER_UP, "..", goUp, "Up to parent folder"));
      for (const name of subDirs) el.list.appendChild(navRow(ICON_FOLDER, name, () => descend(name), `Open folder “${name}”`));
    }
    // Files in the current directory (or local pads), most-recently-edited first.
    const pads = [...store.pads].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const pad of pads) {
      const li = document.createElement("li");
      li.dataset.id = pad.id;
      if (pad.id === store.activeId) li.classList.add("active");

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
    const pad = activePad();
    el.preview.innerHTML = marked.parse((pad && pad.content) || "");
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
    // No matching target (e.g. hand-written #html anchors) → do nothing.
  }

  function renderCounter() {
    const pad = activePad();
    const words = (((pad && pad.content) || "").match(/\S+/g) || []).length;
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
    store.activeId = id;
    loadActiveIntoEditor();
    renderList();
    renderCounter();
    if (state.mode !== "preview") el.editor.focus();
    applyMode();
    persist();
  }

  function createPad() {
    const pad = newPad();
    store.pads.push(pad);
    if (storageMode === "folder") {
      const name = uniqueFileName("untitled");
      fileNames.set(pad.id, name);
      writeFile(name, ""); // materialize the file now
    }
    switchTo(pad.id);
  }

  function deletePad(id) {
    const pad = store.pads.find((p) => p.id === id);
    if (pad && pad.content.trim() && !confirm(`Delete "${titleOf(pad) || "Untitled"}"?`)) return;
    if (storageMode === "folder") {
      const name = fileNames.get(id);
      if (name && dirHandle) dirHandle.removeEntry(name).catch(() => {});
      fileNames.delete(id);
    }
    store.pads = store.pads.filter((p) => p.id !== id);
    // Local mode always keeps one pad; a folder may legitimately be left empty.
    if (!store.pads.length && storageMode === "local") store.pads.push(newPad());
    if (id === store.activeId) store.activeId = store.pads[0]?.id ?? null;
    loadActiveIntoEditor();
    renderList();
    renderCounter();
    applyMode();
    persist();
  }

  function onInput() {
    const pad = activePad();
    if (!pad) return; // empty folder, nothing selected
    pad.content = el.editor.value;
    pad.updatedAt = Date.now();
    persist();          // settings + local blob
    renderCounter();
    if (state.mode !== "edit") renderPreview();
    scheduleTitleRefresh();
    if (storageMode === "folder") scheduleFileFlush(pad); // debounced write to disk
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

  // ---- Folder storage (File System Access API) ---------------------------
  // Minimal IndexedDB key/value store, used only to remember the folder handle.
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("markhere", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const rq = db.transaction("kv", "readonly").objectStore("kv").get(key);
      rq.onsuccess = () => res(rq.result ?? null);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  // A ".md" filename unique among the current pads (excluding one pad's own name).
  function uniqueFileName(base, excludeId) {
    const used = new Set();
    for (const [pid, name] of fileNames) if (pid !== excludeId) used.add(name.toLowerCase());
    let candidate = `${base}.md`, n = 1;
    while (used.has(candidate.toLowerCase())) candidate = `${base}-${++n}.md`;
    return candidate;
  }

  async function writeTo(handle, name, content) {
    const fh = await handle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }
  async function writeFile(name, content) {
    if (!dirHandle) return;
    try { await writeTo(dirHandle, name, content); markSaved(true); }
    catch (e) { markSaved(false, e); }
  }

  // Read one directory (no recursion): its .md files as pads + its subfolder names.
  async function readDir(handle) {
    const pads = [], dirs = [];
    fileNames.clear();
    for await (const [name, h] of handle.entries()) {
      if (h.kind === "directory") { dirs.push(name); continue; }
      if (!name.toLowerCase().endsWith(".md")) continue;
      let content = "", mtime = Date.now();
      try { const f = await h.getFile(); content = await f.text(); mtime = f.lastModified || mtime; }
      catch { /* skip unreadable entries */ }
      const pad = { id: crypto.randomUUID(), content, createdAt: mtime, updatedAt: mtime };
      pads.push(pad);
      fileNames.set(pad.id, name);
    }
    pads.sort((a, b) => b.updatedAt - a.updatedAt);
    dirs.sort((a, b) => a.localeCompare(b));
    return { pads, dirs };
  }

  let flushTimer = null;
  function scheduleFileFlush(pad) {
    clearTimeout(flushTimer);
    const id = pad.id;
    flushTimer = setTimeout(() => flushPad(id), 600);
  }
  async function flushPad(id) {
    if (storageMode !== "folder" || !dirHandle) return;
    const pad = store.pads.find((p) => p.id === id);
    if (!pad) return;
    const current = fileNames.get(id);
    const desired = uniqueFileName(slugify(titleOf(pad)) || "untitled", id);
    if (current && current.toLowerCase() !== desired.toLowerCase()) {
      // Title changed → rename on disk (write new, remove old).
      await writeFile(desired, pad.content);
      try { await dirHandle.removeEntry(current); } catch { /* already gone */ }
      fileNames.set(id, desired);
      renderList(); // shown filename may have changed
    } else {
      const name = current || desired;
      fileNames.set(id, name);
      await writeFile(name, pad.content);
    }
  }

  // Load the current directory (dirHandle) into the view.
  async function openDir() {
    const { pads, dirs } = await readDir(dirHandle);
    subDirs = dirs;
    store = { pads, activeId: pads[0]?.id ?? null };
    loadActiveIntoEditor();
    renderList();
    renderCounter();
    applyMode();
    updateStorageUI();
  }

  // Write out a debounced edit immediately (before navigating away or closing).
  async function flushPendingNow() {
    if (storageMode === "folder" && flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
      const p = activePad();
      if (p) await flushPad(p.id);
    }
  }

  async function descend(name) {
    await flushPendingNow();
    try {
      const h = await dirHandle.getDirectoryHandle(name);
      pathStack.push(h);
      dirHandle = h;
      await openDir();
      if (state.mode !== "preview") el.editor.focus();
    } catch (e) { console.warn("markhere: cannot open subfolder", name, e); }
  }

  async function goUp() {
    if (pathStack.length <= 1) return; // can't go above the chosen root
    await flushPendingNow();
    pathStack.pop();
    dirHandle = pathStack[pathStack.length - 1];
    await openDir();
    if (state.mode !== "preview") el.editor.focus();
  }

  async function enterFolderMode(handle) {
    rootHandle = handle;
    pathStack = [handle];
    dirHandle = handle;      // start at the chosen root
    pendingHandle = null;
    storageMode = "folder";
    state.storageMode = "folder";
    persist();
    await openDir();
    if (state.mode !== "preview") el.editor.focus();
  }

  async function useLocalStorage() {
    await flushPendingNow();
    storageMode = "local";
    rootHandle = null;
    dirHandle = null;
    pathStack = [];
    subDirs = [];
    pendingHandle = null;
    fileNames.clear();
    store = state; // back to the persisted local pads (never touched while away)
    state.storageMode = "local";
    try { await idbSet("dirHandle", null); } catch { /* ignore */ }
    persist();
    loadActiveIntoEditor();
    renderList();
    renderCounter();
    applyMode();
    updateStorageUI();
    if (state.mode !== "preview") el.editor.focus();
  }

  async function chooseFolder() {
    if (!FS_SUPPORTED) return;
    let handle;
    try { handle = await window.showDirectoryPicker({ mode: "readwrite", id: "markhere" }); }
    catch { return; } // user cancelled the picker
    try { if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") return; }
    catch { /* some handles need no explicit grant */ }

    // One-time migration: copy existing non-empty local pads into the folder.
    const localPads = state.pads.filter((p) => p.content.trim());
    if (localPads.length &&
        confirm(`Copy your ${localPads.length} local pad(s) into this folder as .md files?`)) {
      const used = new Set();
      for (const p of localPads) {
        const base = slugify(titleOf(p)) || "untitled";
        let name = `${base}.md`, n = 1;
        while (used.has(name.toLowerCase())) name = `${base}-${++n}.md`;
        used.add(name.toLowerCase());
        try { await writeTo(handle, name, p.content); } catch (e) { console.warn("migrate failed:", e); }
      }
    }
    try { await idbSet("dirHandle", handle); } catch { /* ignore */ }
    await enterFolderMode(handle);
  }

  async function restoreFolder() {
    if (!FS_SUPPORTED || state.storageMode !== "folder") return;
    let handle;
    try { handle = await idbGet("dirHandle"); } catch { return; }
    if (!handle) return;
    let perm = "prompt";
    try { perm = await handle.queryPermission({ mode: "readwrite" }); } catch { /* ignore */ }
    if (perm === "granted") await enterFolderMode(handle);
    else { pendingHandle = handle; updateStorageUI(); } // needs a click to re-grant
  }

  async function reconnectFolder() {
    if (!pendingHandle) return;
    let perm = "denied";
    try { perm = await pendingHandle.requestPermission({ mode: "readwrite" }); } catch { /* ignore */ }
    if (perm === "granted") await enterFolderMode(pendingHandle);
  }

  function updateStorageUI() {
    // Status line
    if (!saveOk) el.storageNote.textContent = "⚠ Couldn’t save";
    else if (storageMode === "folder" && dirHandle) el.storageNote.textContent = "Folder: " + pathStack.map((h) => h.name).join(" / ");
    else if (pendingHandle) el.storageNote.textContent = "Folder access paused";
    else el.storageNote.textContent = "Saved in browser";

    // Control button
    const wrap = el.storageControls;
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!FS_SUPPORTED) return; // no folder option in this browser
    const btn = document.createElement("button");
    btn.className = "storage-btn";
    const set = (icon, label, handler) => {
      btn.innerHTML = icon;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.addEventListener("click", handler);
    };
    if (storageMode === "folder") set(ICON_MONITOR, "Switch to browser storage", useLocalStorage);
    else if (pendingHandle) set(ICON_FOLDER, `Reconnect “${pendingHandle.name}”`, reconnectFolder);
    else set(ICON_FOLDER, "Save to a folder…", chooseFolder);
    wrap.appendChild(btn);
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

    // Folder mode: flush a pending write when the page is hidden/closed.
    const flushNow = () => {
      if (storageMode === "folder" && flushTimer) { clearTimeout(flushTimer); flushPad(activePad()?.id); }
    };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });
    window.addEventListener("pagehide", flushNow);
  }

  // ---- Boot --------------------------------------------------------------
  load();
  applyTheme();
  applyFont();
  applyPreviewWidth();
  bind();
  loadActiveIntoEditor();
  renderList();
  renderCounter();
  applyMode();
  if (state.mode !== "preview") el.editor.focus();
  updateStorageUI();
  restoreFolder(); // async: upgrade to folder mode if one was remembered & still permitted

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
