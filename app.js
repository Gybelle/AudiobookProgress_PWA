'use strict';

const STORAGE_KEY = 'audiobook-progress-v3';
const OLD_KEY     = 'audiobook-progress-v1';

let state = {
  activeBookId: 1,
  books: []
};

let nextBookId = 1;
let nextPartId = 1;

// ── Factories ──────────────────────────────────────────────

function createPart() {
  return { id: nextPartId++, listenedH: 0, listenedM: 0, totalH: 0, totalM: 0, remainH: 0, remainM: 0 };
}

function createBook(title = '') {
  return {
    id: nextBookId++,
    title,
    trackingType: 'time',  // 'time' | 'percent' | 'pages'
    mode: 'total',          // 'total' | 'remaining' (time mode only)
    totalPages: 0,
    currentPage: 0,         // pages mode
    listenedPct: 0,         // percent mode (0–100)
    settingsOpen: false,
    parts: [createPart()]
  };
}

function activeBook() {
  return state.books.find(b => b.id === state.activeBookId) || state.books[0];
}

// ── Persistence ───────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.activeBookId = saved.activeBookId || 1;
      state.books = (saved.books || []).map(b => {
        const parts = (b.parts || []).map(p => ({
          id:        p.id || nextPartId++,
          listenedH: clampH(p.listenedH ?? p.timeH),
          listenedM: clampM(p.listenedM ?? p.timeM),
          totalH:    clampH(p.totalH),
          totalM:    clampM(p.totalM),
          remainH:   clampH(p.remainH),
          remainM:   clampM(p.remainM)
        }));
        const tt = ['time', 'percent', 'pages'].includes(b.trackingType) ? b.trackingType : 'time';
        return {
          id:           b.id || nextBookId++,
          title:        b.title || '',
          trackingType: tt,
          mode:         b.mode === 'remaining' ? 'remaining' : 'total',
          totalPages:   Math.max(0, parseInt(b.totalPages) || 0),
          currentPage:  Math.max(0, parseInt(b.currentPage) || 0),
          listenedPct:  Math.min(100, Math.max(0, parseFloat(b.listenedPct) || 0)),
          settingsOpen: b.settingsOpen === true,
          parts
        };
      });
      if (state.books.length > 0) {
        nextBookId = Math.max(...state.books.map(b => b.id)) + 1;
        const allParts = state.books.flatMap(b => b.parts);
        if (allParts.length > 0) nextPartId = Math.max(...allParts.map(p => p.id)) + 1;
      }
      return;
    }
    // migrate from v1
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const saved = JSON.parse(old);
      const parts = (saved.parts || []).map(p => ({
        id: nextPartId++,
        listenedH: clampH(p.listenedH ?? p.timeH),
        listenedM: clampM(p.listenedM ?? p.timeM),
        totalH: clampH(p.totalH), totalM: clampM(p.totalM),
        remainH: clampH(p.remainH), remainM: clampM(p.remainM)
      }));
      const book = {
        id: nextBookId++, title: '',
        trackingType: 'time',
        mode: saved.mode === 'remaining' ? 'remaining' : 'total',
        totalPages: 0, currentPage: 0, listenedPct: 0,
        parts: parts.length ? parts : [createPart()]
      };
      state.books = [book];
      state.activeBookId = book.id;
    }
  } catch (_) {}
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Helpers ───────────────────────────────────────────────

function clampH(v)     { return Math.max(0, Math.min(999,   parseInt(v)   || 0)); }
function clampM(v)     { return Math.max(0, Math.min(59,    parseInt(v)   || 0)); }
function clampPages(v) { return Math.max(0, Math.min(99999, parseInt(v)   || 0)); }
function clampPct(v)   { return Math.max(0, Math.min(100,   parseFloat(v) || 0)); }

function partMinutes(part, mode) {
  const listened = part.listenedH * 60 + part.listenedM;
  if (mode === 'total') {
    const total = part.totalH * 60 + part.totalM;
    return { listened: Math.min(listened, total), total };
  } else {
    const remain = part.remainH * 60 + part.remainM;
    return { listened, total: listened + remain };
  }
}

// ── Book actions ──────────────────────────────────────────

function addBook() {
  const book = createBook();
  state.books.push(book);
  state.activeBookId = book.id;
  saveState();
  renderAll();
  setTimeout(() => document.getElementById('book-title-input')?.focus(), 50);
}

function removeBook() {
  if (state.books.length <= 1) return;
  state.books = state.books.filter(b => b.id !== state.activeBookId);
  state.activeBookId = state.books[state.books.length - 1].id;
  saveState();
  renderAll();
}

function switchBook(id) {
  state.activeBookId = id;
  saveState();
  renderAll();
}

function updateBookTitle(value) {
  const book = activeBook();
  if (!book) return;
  book.title = value;
  saveState();
  renderTabs();
}

// ── Tracking type & mode ──────────────────────────────────

function toggleSettings() {
  const book = activeBook();
  if (!book) return;
  book.settingsOpen = !book.settingsOpen;
  saveState();
  renderBookSettings();
}

function setTrackingType(type) {
  const book = activeBook();
  if (!book) return;
  book.trackingType = type;
  saveState();
  renderBookSettings();
  renderParts();
  updateProgress();
}

function setMode(mode) {
  const book = activeBook();
  if (!book) return;
  book.mode = mode;
  saveState();
  renderBookSettings();
  renderParts();
  updateProgress();
}

function updateTotalPages(value) {
  const book = activeBook();
  if (!book) return;
  book.totalPages = clampPages(value);
  saveState();
  updateProgress();
  renderParts();
}

function updateCurrentPage(value) {
  const book = activeBook();
  if (!book) return;
  book.currentPage = clampPages(value);
  saveState();
  updateProgress();
}

function updateListenedPct(value) {
  const book = activeBook();
  if (!book) return;
  book.listenedPct = clampPct(value);
  saveState();
  updateProgress();
}

// ── Part actions ──────────────────────────────────────────

function addPart() {
  const book = activeBook();
  if (!book) return;
  book.parts.push(createPart());
  saveState();
  renderParts();
  updateProgress();
}

function removePart(id) {
  const book = activeBook();
  if (!book || book.parts.length <= 1) return;
  book.parts = book.parts.filter(p => p.id !== id);
  saveState();
  renderParts();
  updateProgress();
}

function updateField(id, field, rawValue, inputEl) {
  const book = activeBook();
  if (!book) return;
  const part = book.parts.find(p => p.id === id);
  if (!part) return;
  const isMin = (field === 'listenedM' || field === 'totalM' || field === 'remainM');
  const clamped = isMin ? clampM(rawValue) : clampH(rawValue);
  part[field] = clamped;
  if (inputEl && parseInt(rawValue) !== clamped) inputEl.value = clamped;
  saveState();
  updateProgress();
  updatePartMiniBar(id);
}

// ── Progress ──────────────────────────────────────────────

function updateProgress() {
  const book = activeBook();
  const pctEl     = document.getElementById('progress-pct');
  const barEl     = document.getElementById('progress-bar');
  const detailsEl = document.getElementById('progress-details');
  if (!book) return;

  const tt = book.trackingType || 'time';

  if (tt === 'percent') {
    const pct = book.listenedPct || 0;
    const isComplete = pct >= 100;
    pctEl.textContent = pct.toFixed(1) + '%';
    pctEl.classList.toggle('complete', isComplete);
    barEl.style.width = pct + '%';
    barEl.classList.toggle('complete', isComplete);
    if (pct === 0) {
      detailsEl.textContent = 'Enter your progress below';
    } else if (isComplete) {
      detailsEl.textContent = 'Finished!';
    } else {
      const pageHint = book.totalPages > 0
        ? ` · approx. page ${Math.round(pct / 100 * book.totalPages)} of ${book.totalPages}`
        : '';
      detailsEl.textContent = `${pct.toFixed(1)}% read${pageHint}`;
    }
    return;
  }

  if (tt === 'pages') {
    if (book.totalPages === 0) {
      pctEl.textContent = '—';
      pctEl.classList.remove('complete');
      barEl.style.width = '0%';
      barEl.classList.remove('complete');
      detailsEl.textContent = 'Set the total number of pages below';
      return;
    }
    const pct = Math.min(100, (book.currentPage / book.totalPages) * 100);
    const isComplete = book.currentPage >= book.totalPages;
    pctEl.textContent = pct.toFixed(1) + '%';
    pctEl.classList.toggle('complete', isComplete);
    barEl.style.width = pct + '%';
    barEl.classList.toggle('complete', isComplete);
    detailsEl.textContent = isComplete
      ? `Finished! ${book.totalPages} pages`
      : `Page ${book.currentPage} of ${book.totalPages}`;
    return;
  }

  // time mode
  let grandTotal = 0, grandListened = 0;
  for (const part of book.parts) {
    const { listened, total } = partMinutes(part, book.mode);
    grandTotal    += total;
    grandListened += listened;
  }

  if (grandTotal === 0) {
    pctEl.textContent = '—';
    pctEl.classList.remove('complete');
    barEl.style.width = '0%';
    barEl.classList.remove('complete');
    detailsEl.textContent = 'Enter duration data below to calculate progress';
    return;
  }

  const pct = Math.min(100, (grandListened / grandTotal) * 100);
  const isComplete = pct >= 100;

  pctEl.textContent = pct.toFixed(1) + '%';
  pctEl.classList.toggle('complete', isComplete);
  barEl.style.width = pct + '%';
  barEl.classList.toggle('complete', isComplete);

  const lH = Math.floor(grandListened / 60), lM = grandListened % 60;
  const tH = Math.floor(grandTotal / 60),    tM = grandTotal % 60;
  const rem = grandTotal - grandListened;
  const rH = Math.floor(rem / 60), rM = rem % 60;

  const pageHint = book.totalPages > 0
    ? ` · approx. page ${Math.round(pct / 100 * book.totalPages)} of ${book.totalPages}`
    : '';

  detailsEl.textContent = isComplete
    ? `Finished! ${tH}h ${tM}m total`
    : `${lH}h ${lM}m listened · ${rH}h ${rM}m remaining · ${tH}h ${tM}m total${pageHint}`;
}

function updatePartMiniBar(id) {
  const book = activeBook();
  if (!book) return;
  const part = book.parts.find(p => p.id === id);
  if (!part) return;
  const { listened, total } = partMinutes(part, book.mode);
  const pct = total === 0 ? 0 : Math.min(100, (listened / total) * 100);
  const miniBar = document.querySelector(`.part-mini-bar[data-id="${id}"]`);
  const miniPct = document.querySelector(`.part-pct[data-id="${id}"]`);
  if (miniBar) miniBar.style.width = pct + '%';
  if (miniPct) miniPct.textContent = total === 0 ? '—' : pct.toFixed(0) + '%';
}

// ── Render ────────────────────────────────────────────────

function renderTabs() {
  const scroll = document.getElementById('tabs-scroll');
  const showRemove = state.books.length > 1;
  scroll.innerHTML = state.books.map(book => {
    const label = book.title.trim() || 'Untitled';
    const isActive = book.id === state.activeBookId;
    return `
      <button class="tab ${isActive ? 'active' : ''}" onclick="switchBook(${book.id})">
        <span class="tab-label">${escHtml(label)}</span>
        ${showRemove ? `<span class="tab-remove" onclick="event.stopPropagation(); removeBookById(${book.id})">✕</span>` : ''}
      </button>`;
  }).join('');

  const activeTab = scroll.querySelector('.tab.active');
  if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function renderBookTitle() {
  const book = activeBook();
  const input = document.getElementById('book-title-input');
  const delBtn = document.getElementById('delete-book-btn');
  if (input) input.value = book ? book.title : '';
  if (delBtn) delBtn.disabled = state.books.length <= 1;
}

function renderBookSettings() {
  const book = activeBook();
  const container = document.getElementById('book-settings-section');
  if (!book || !container) return;

  const tt = book.trackingType || 'time';
  const open = book.settingsOpen;

  const ttLabel = tt === 'time' ? 'Time' : tt === 'percent' ? 'Percent' : 'Pages';
  const summaryExtra = book.totalPages > 0 ? ` · ${book.totalPages} p.` : '';
  const chevron = open ? '▴' : '▾';

  const timeSubHTML = tt === 'time' ? `
    <div class="settings-row">
      <span class="section-label" style="margin-bottom:0">Second field</span>
      <div class="toggle-container cols-2 compact">
        <button class="toggle-btn ${book.mode === 'total' ? 'active' : ''}" onclick="setMode('total')">Total</button>
        <button class="toggle-btn ${book.mode === 'remaining' ? 'active' : ''}" onclick="setMode('remaining')">Remaining</button>
      </div>
    </div>` : '';

  const pagesFieldHTML = `
    <div class="settings-row">
      <span class="section-label" style="margin-bottom:0">Total pages</span>
      <div class="time-inputs">
        <input type="number" class="time-input wide-input" inputmode="numeric" min="0" max="99999"
          placeholder="0" value="${book.totalPages > 0 ? book.totalPages : ''}"
          onfocus="this.select()"
          oninput="updateTotalPages(this.value)"
          onchange="updateTotalPages(this.value)">
        <span class="time-sep">p.</span>
      </div>
    </div>`;

  const bodyHTML = open ? `
      <div class="toggle-container cols-3">
        <button class="toggle-btn ${tt === 'time' ? 'active' : ''}" onclick="setTrackingType('time')">Time</button>
        <button class="toggle-btn ${tt === 'percent' ? 'active' : ''}" onclick="setTrackingType('percent')">Percent</button>
        <button class="toggle-btn ${tt === 'pages' ? 'active' : ''}" onclick="setTrackingType('pages')">Pages</button>
      </div>
      ${timeSubHTML}
      ${pagesFieldHTML}` : '';

  container.innerHTML = `
    <div class="card toggle-section settings-card ${open ? '' : 'settings-collapsed'}">
      <button class="settings-header" onclick="toggleSettings()">
        <span class="settings-summary"><span class="settings-summary-type">${ttLabel}</span>${escHtml(summaryExtra)}</span>
        <span class="settings-chevron">${chevron}</span>
      </button>
      ${bodyHTML}
    </div>`;
}

function renderParts() {
  const book = activeBook();
  const container = document.getElementById('parts-list');
  const partsHeader = document.getElementById('parts-section-header');
  if (!book) { container.innerHTML = ''; return; }

  const tt = book.trackingType || 'time';

  if (tt === 'percent') {
    if (partsHeader) partsHeader.style.display = 'none';
    container.innerHTML = `
      <div class="part-card">
        <div class="part-row">
          <label>Progress</label>
          <div class="time-inputs">
            <input type="number" class="time-input wide-input" inputmode="decimal" min="0" max="100" step="0.1"
              placeholder="0" value="${book.listenedPct > 0 ? book.listenedPct : ''}"
              onfocus="this.select()"
              oninput="updateListenedPct(this.value)"
              onchange="updateListenedPct(this.value)">
            <span class="time-sep">%</span>
          </div>
        </div>
      </div>`;
    return;
  }

  if (tt === 'pages') {
    if (partsHeader) partsHeader.style.display = 'none';
    const ofLabel = book.totalPages > 0 ? `<span class="time-sep">of ${book.totalPages} p.</span>` : '';
    container.innerHTML = `
      <div class="part-card">
        <div class="part-row">
          <label>Current page</label>
          <div class="time-inputs">
            <input type="number" class="time-input wide-input" inputmode="numeric" min="0" max="99999"
              placeholder="0" value="${book.currentPage > 0 ? book.currentPage : ''}"
              onfocus="this.select()"
              oninput="updateCurrentPage(this.value)"
              onchange="updateCurrentPage(this.value)">
            ${ofLabel}
          </div>
        </div>
      </div>`;
    return;
  }

  // time mode
  if (partsHeader) partsHeader.style.display = '';

  const secondLabel = book.mode === 'total' ? 'Total duration' : 'Remaining';
  const showRemove  = book.parts.length > 1;

  container.innerHTML = book.parts.map((part, index) => {
    const { listened, total } = partMinutes(part, book.mode);
    const pct     = total === 0 ? 0 : Math.min(100, (listened / total) * 100);
    const pctText = total === 0 ? '—' : pct.toFixed(0) + '%';
    const secondH = book.mode === 'total' ? part.totalH  : part.remainH;
    const secondM = book.mode === 'total' ? part.totalM  : part.remainM;
    const fieldH  = book.mode === 'total' ? 'totalH'     : 'remainH';
    const fieldM  = book.mode === 'total' ? 'totalM'     : 'remainM';

    return `
      <div class="part-card" data-id="${part.id}">
        <div class="part-header">
          <span class="part-title">Part ${index + 1}</span>
          ${showRemove ? `<button class="remove-btn" onclick="removePart(${part.id})" title="Remove part">✕</button>` : ''}
        </div>
        <div class="part-row">
          <label>Listened</label>
          <div class="time-inputs">
            <input type="number" class="time-input" inputmode="numeric" min="0" max="999" value="${part.listenedH}"
              onfocus="this.select()"
              oninput="updateField(${part.id},'listenedH',this.value,this)"
              onchange="updateField(${part.id},'listenedH',this.value,this)">
            <span class="time-sep">h</span>
            <input type="number" class="time-input" inputmode="numeric" min="0" max="59" value="${part.listenedM}"
              onfocus="this.select()"
              oninput="updateField(${part.id},'listenedM',this.value,this)"
              onchange="updateField(${part.id},'listenedM',this.value,this)">
            <span class="time-sep">m</span>
          </div>
        </div>
        <div class="part-row">
          <label>${secondLabel}</label>
          <div class="time-inputs">
            <input type="number" class="time-input" inputmode="numeric" min="0" max="999" value="${secondH}"
              onfocus="this.select()"
              oninput="updateField(${part.id},'${fieldH}',this.value,this)"
              onchange="updateField(${part.id},'${fieldH}',this.value,this)">
            <span class="time-sep">h</span>
            <input type="number" class="time-input" inputmode="numeric" min="0" max="59" value="${secondM}"
              onfocus="this.select()"
              oninput="updateField(${part.id},'${fieldM}',this.value,this)"
              onchange="updateField(${part.id},'${fieldM}',this.value,this)">
            <span class="time-sep">m</span>
          </div>
        </div>
        <div class="part-summary">
          <div class="part-mini-bar-container">
            <div class="part-mini-bar" data-id="${part.id}" style="width:${pct}%"></div>
          </div>
          <span class="part-pct" data-id="${part.id}">${pctText}</span>
        </div>
      </div>`;
  }).join('');
}

function renderAll() {
  renderTabs();
  renderBookTitle();
  renderBookSettings();
  renderParts();
  updateProgress();
}

// ── Utility ───────────────────────────────────────────────

function removeBookById(id) {
  if (state.books.length <= 1) return;
  const wasActive = state.activeBookId === id;
  state.books = state.books.filter(b => b.id !== id);
  if (wasActive) state.activeBookId = state.books[state.books.length - 1].id;
  saveState();
  renderAll();
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────

function init() {
  loadState();
  if (state.books.length === 0) {
    const book = createBook();
    state.books.push(book);
    state.activeBookId = book.id;
  }
  renderAll();
  registerSW();
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
