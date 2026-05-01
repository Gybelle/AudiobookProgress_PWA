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
  return { id: nextBookId++, title, mode: 'total', parts: [createPart()] };
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
          id:       p.id || nextPartId++,
          listenedH: clampH(p.listenedH ?? p.timeH),
          listenedM: clampM(p.listenedM ?? p.timeM),
          totalH:   clampH(p.totalH),
          totalM:   clampM(p.totalM),
          remainH:  clampH(p.remainH),
          remainM:  clampM(p.remainM)
        }));
        return { id: b.id || nextBookId++, title: b.title || '', mode: b.mode === 'remaining' ? 'remaining' : 'total', parts };
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
      const book = { id: nextBookId++, title: '', mode: saved.mode === 'remaining' ? 'remaining' : 'total', parts: parts.length ? parts : [createPart()] };
      state.books = [book];
      state.activeBookId = book.id;
    }
  } catch (_) {}
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Helpers ───────────────────────────────────────────────

function clampH(v) { return Math.max(0, Math.min(999, parseInt(v) || 0)); }
function clampM(v) { return Math.max(0, Math.min(59,  parseInt(v) || 0)); }

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
  // focus title input
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

// ── Mode ──────────────────────────────────────────────────

function setMode(mode) {
  const book = activeBook();
  if (!book) return;
  book.mode = mode;
  saveState();
  renderModeButtons();
  renderParts();
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

  detailsEl.textContent = isComplete
    ? `Finished! ${tH}h ${tM}m total`
    : `${lH}h ${lM}m listened · ${rH}h ${rM}m remaining · ${tH}h ${tM}m total`;
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

  // scroll active tab into view
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

function renderModeButtons() {
  const book = activeBook();
  const mode = book ? book.mode : 'total';
  document.getElementById('btn-total').classList.toggle('active', mode === 'total');
  document.getElementById('btn-remaining').classList.toggle('active', mode === 'remaining');
}

function renderParts() {
  const book = activeBook();
  const container = document.getElementById('parts-list');
  if (!book) { container.innerHTML = ''; return; }

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
  renderModeButtons();
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
