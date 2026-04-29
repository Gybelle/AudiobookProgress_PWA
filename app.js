'use strict';

const STORAGE_KEY = 'audiobook-progress-v1';

// mode: 'total' → second field = total duration
//       'remaining' → second field = remaining time
let state = {
  mode: 'total',
  parts: []
};

let nextId = 1;

function createPart() {
  return { id: nextId++, listenedH: 0, listenedM: 0, totalH: 0, totalM: 0, remainH: 0, remainM: 0 };
}

function init() {
  loadState();
  if (state.parts.length === 0) {
    state.parts.push(createPart());
  }
  renderAll();
  registerSW();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.mode = saved.mode === 'remaining' ? 'remaining' : 'total';
    if (Array.isArray(saved.parts) && saved.parts.length > 0) {
      state.parts = saved.parts.map(p => ({
        id: p.id || nextId++,
        // migrate old field name 'timeH/timeM' → listenedH/listenedM
        listenedH: clampH(p.listenedH ?? p.timeH),
        listenedM: clampM(p.listenedM ?? p.timeM),
        totalH:    clampH(p.totalH),
        totalM:    clampM(p.totalM),
        remainH:   clampH(p.remainH),
        remainM:   clampM(p.remainM)
      }));
      nextId = Math.max(...state.parts.map(p => p.id)) + 1;
    }
  } catch (_) {}
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clampH(v) { return Math.max(0, Math.min(999, parseInt(v) || 0)); }
function clampM(v) { return Math.max(0, Math.min(59,  parseInt(v) || 0)); }

function setMode(mode) {
  state.mode = mode;
  saveState();
  renderModeButtons();
  renderParts();
  updateProgress();
}

function addPart() {
  state.parts.push(createPart());
  saveState();
  renderParts();
  updateProgress();
}

function removePart(id) {
  if (state.parts.length <= 1) return;
  state.parts = state.parts.filter(p => p.id !== id);
  saveState();
  renderParts();
  updateProgress();
}

function updateField(id, field, rawValue, inputEl) {
  const part = state.parts.find(p => p.id === id);
  if (!part) return;
  const isMinutes = field.endsWith('M') || field.endsWith('m') && field !== 'remainM' || field === 'listenedM' || field === 'totalM' || field === 'remainM';
  // simpler: check last char
  const clamped = (field === 'listenedM' || field === 'totalM' || field === 'remainM')
    ? clampM(rawValue)
    : clampH(rawValue);
  part[field] = clamped;
  if (inputEl && parseInt(rawValue) !== clamped) {
    inputEl.value = clamped;
  }
  saveState();
  updateProgress();
  updatePartMiniBar(id);
}

function partMinutes(part) {
  const listened = part.listenedH * 60 + part.listenedM;
  if (state.mode === 'total') {
    const total = part.totalH * 60 + part.totalM;
    return { listened: Math.min(listened, total), total };
  } else {
    const remain = part.remainH * 60 + part.remainM;
    const total  = listened + remain;
    return { listened, total };
  }
}

function updateProgress() {
  let grandTotal    = 0;
  let grandListened = 0;

  for (const part of state.parts) {
    const { listened, total } = partMinutes(part);
    grandTotal    += total;
    grandListened += listened;
  }

  const pctEl     = document.getElementById('progress-pct');
  const barEl     = document.getElementById('progress-bar');
  const detailsEl = document.getElementById('progress-details');

  if (grandTotal === 0) {
    pctEl.textContent = '—';
    pctEl.classList.remove('complete');
    barEl.style.width = '0%';
    barEl.classList.remove('complete');
    detailsEl.textContent = 'Enter duration data above to calculate progress';
    return;
  }

  const pct = Math.min(100, (grandListened / grandTotal) * 100);
  const isComplete = pct >= 100;

  pctEl.textContent = pct.toFixed(1) + '%';
  pctEl.classList.toggle('complete', isComplete);
  barEl.style.width = pct + '%';
  barEl.classList.toggle('complete', isComplete);

  const lH = Math.floor(grandListened / 60);
  const lM = grandListened % 60;
  const tH = Math.floor(grandTotal / 60);
  const tM = grandTotal % 60;
  const remMin = grandTotal - grandListened;
  const rH = Math.floor(remMin / 60);
  const rM = remMin % 60;

  if (isComplete) {
    detailsEl.textContent = `Finished! ${tH}h ${tM}m total`;
  } else {
    detailsEl.textContent = `${lH}h ${lM}m listened · ${rH}h ${rM}m remaining · ${tH}h ${tM}m total`;
  }
}

function updatePartMiniBar(id) {
  const part = state.parts.find(p => p.id === id);
  if (!part) return;
  const { listened, total } = partMinutes(part);
  const pct = total === 0 ? 0 : Math.min(100, (listened / total) * 100);

  const miniBar = document.querySelector(`.part-mini-bar[data-id="${id}"]`);
  const miniPct = document.querySelector(`.part-pct[data-id="${id}"]`);
  if (miniBar) miniBar.style.width = pct + '%';
  if (miniPct) miniPct.textContent = total === 0 ? '—' : pct.toFixed(0) + '%';
}

function renderParts() {
  const container = document.getElementById('parts-list');
  const secondLabel = state.mode === 'total' ? 'Total duration' : 'Remaining';
  const showRemove = state.parts.length > 1;

  container.innerHTML = state.parts.map((part, index) => {
    const { listened, total } = partMinutes(part);
    const pct = total === 0 ? 0 : Math.min(100, (listened / total) * 100);
    const pctText = total === 0 ? '—' : pct.toFixed(0) + '%';

    const secondH = state.mode === 'total' ? part.totalH   : part.remainH;
    const secondM = state.mode === 'total' ? part.totalM   : part.remainM;
    const fieldH  = state.mode === 'total' ? 'totalH'      : 'remainH';
    const fieldM  = state.mode === 'total' ? 'totalM'      : 'remainM';

    return `
      <div class="part-card" data-id="${part.id}">
        <div class="part-header">
          <span class="part-title">Part ${index + 1}</span>
          ${showRemove ? `<button class="remove-btn" onclick="removePart(${part.id})" title="Remove part">✕</button>` : ''}
        </div>

        <div class="part-row">
          <label>Listened</label>
          <div class="time-inputs">
            <input type="number" class="time-input" inputmode="numeric" min="0" max="999"
              value="${part.listenedH}"
              onfocus="this.select()"
              oninput="updateField(${part.id}, 'listenedH', this.value, this)"
              onchange="updateField(${part.id}, 'listenedH', this.value, this)">
            <span class="time-sep">h</span>
            <input type="number" class="time-input" inputmode="numeric" min="0" max="59"
              value="${part.listenedM}"
              onfocus="this.select()"
              oninput="updateField(${part.id}, 'listenedM', this.value, this)"
              onchange="updateField(${part.id}, 'listenedM', this.value, this)">
            <span class="time-sep">m</span>
          </div>
        </div>

        <div class="part-row">
          <label>${secondLabel}</label>
          <div class="time-inputs">
            <input type="number" class="time-input" inputmode="numeric" min="0" max="999"
              value="${secondH}"
              onfocus="this.select()"
              oninput="updateField(${part.id}, '${fieldH}', this.value, this)"
              onchange="updateField(${part.id}, '${fieldH}', this.value, this)">
            <span class="time-sep">h</span>
            <input type="number" class="time-input" inputmode="numeric" min="0" max="59"
              value="${secondM}"
              onfocus="this.select()"
              oninput="updateField(${part.id}, '${fieldM}', this.value, this)"
              onchange="updateField(${part.id}, '${fieldM}', this.value, this)">
            <span class="time-sep">m</span>
          </div>
        </div>

        <div class="part-summary">
          <div class="part-mini-bar-container">
            <div class="part-mini-bar" data-id="${part.id}" style="width:${pct}%"></div>
          </div>
          <span class="part-pct" data-id="${part.id}">${pctText}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderModeButtons() {
  document.getElementById('btn-total').classList.toggle('active', state.mode === 'total');
  document.getElementById('btn-remaining').classList.toggle('active', state.mode === 'remaining');
}

function renderAll() {
  renderModeButtons();
  renderParts();
  updateProgress();
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
