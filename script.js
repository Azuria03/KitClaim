// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const DB_NAME = 'KitClaimDB';
const DB_VER = 1;
const STORE_PARTICIPANTS = 'participants';
const STORE_QUEUE = 'queue';
const STORE_META = 'meta';

let db = null;
let participants = {}; // keyed by bib
let queue = [];        // pending claims
let filter = 'all';
let gasUrl = localStorage.getItem('gasUrl') || '';

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
async function init() {
  db = await openDB();
  gasUrl = localStorage.getItem('gasUrl') || '';
  if (gasUrl) document.getElementById('gasUrlInput').value = gasUrl;

  // Load from IndexedDB
  const stored = await getAllFromStore(STORE_PARTICIPANTS);
  stored.forEach(p => participants[p.bib] = p);

  const storedQ = await getAllFromStore(STORE_QUEUE);
  queue = storedQ;

  updateUI();
  watchOnline();
}

// ═══════════════════════════════════════════════
//  INDEXEDDB
// ═══════════════════════════════════════════════
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_PARTICIPANTS)) d.createObjectStore(STORE_PARTICIPANTS, { keyPath: 'bib' });
      if (!d.objectStoreNames.contains(STORE_QUEUE)) d.createObjectStore(STORE_QUEUE, { autoIncrement: true });
      if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META);
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}

function txPut(store, val) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(val);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

function getAllFromStore(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}

function clearStore(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

async function saveAllParticipants() {
  await clearStore(STORE_PARTICIPANTS);
  for (const p of Object.values(participants)) await txPut(STORE_PARTICIPANTS, p);
}

async function saveQueue() {
  await clearStore(STORE_QUEUE);
  for (const q of queue) await txPut(STORE_QUEUE, q);
}

// ═══════════════════════════════════════════════
//  ONLINE STATUS
// ═══════════════════════════════════════════════
function watchOnline() {
  const update = () => {
    const online = navigator.onLine;
    const pill = document.getElementById('statusPill');
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    pill.className = 'status-pill ' + (online ? 'online' : 'offline');
    dot.className = 'status-dot' + (online ? ' pulse' : '');
    txt.textContent = online ? 'Online' : 'Offline';
    if (online && queue.length > 0) autoSync();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ═══════════════════════════════════════════════
//  FETCH PARTICIPANTS
// ═══════════════════════════════════════════════
async function fetchParticipants() {
  if (!gasUrl) { showToast('Set GAS URL in Config first.', 'warning'); toggleConfig(); return; }
  if (!navigator.onLine) { showToast('You are offline. Cannot fetch.', 'error'); return; }
  const btn = document.getElementById('fetchBtn');
  btn.disabled = true; btn.textContent = 'Fetching…';
  try {
    const res = await fetch(`${gasUrl}?action=participants`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid data format');

    // Re-apply any local claim state
    participants = {};
    data.forEach(p => {
      const existing = participants[p.bib];
      participants[p.bib] = {
        bib: String(p.bib).trim(),
        name: p.name || `${p.firstName} ${p.lastName}`.trim(),
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        gender: p.gender || '',
        team: p.team || '',
        category: p.category || '',
        distance: p.distance || '',
        eventShirt: p.eventShirt || '',
        singlet: p.singlet || '',
        shirtSize: p.shirtSize || '',
        claimed: (p.claimed === true || String(p.claimed).toUpperCase() === 'YES'),
        claimTime: p.claimTime || '',
        source: p.source || 'race'
      };
    });

    await saveAllParticipants();
    showToast(`✓ ${data.length} participants loaded`, 'success');
    updateUI();
  } catch(e) {
    showToast('Fetch failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Fetch Data';
  }
}

// ═══════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════
function onSearch() {
  renderResults(getResults());
}

function setFilter(f, el) {
  filter = f;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderResults(getResults());
}

function getResults() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  let list = Object.values(participants);

  if (filter === 'race') list = list.filter(p => p.source === 'race');
  else if (filter === 'criterium') list = list.filter(p => p.source === 'criterium');
  else if (filter === 'unclaimed') list = list.filter(p => !p.claimed);
  else if (filter === 'claimed') list = list.filter(p => p.claimed);

  if (!q) return list.slice(0, 40);

  // Exact bib match first
  const bibMatch = list.filter(p => p.bib === q);
  if (bibMatch.length) return bibMatch;

  // Partial name / bib
  return list.filter(p =>
    p.bib.startsWith(q) ||
    p.name.toLowerCase().includes(q) ||
    p.firstName.toLowerCase().includes(q) ||
    p.lastName.toLowerCase().includes(q)
  ).slice(0, 20);
}

function renderResults(list) {
  const area = document.getElementById('resultsArea');
  if (!Object.keys(participants).length) {
    area.innerHTML = `<div class="empty-state"><div class="icon">🏁</div><p>Fetch data to begin, then search for participants.</p></div>`;
    return;
  }
  if (!list.length) {
    area.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No participants found.</p></div>`;
    return;
  }

  area.innerHTML = list.map(p => {
    const isRace = p.source === 'race';
    const claimedClass = p.claimed ? 'claimed' : '';
    const sourceClass = isRace ? 'race-card' : 'crit-card';
    const sourceBadge = isRace
      ? `<span class="source-badge race">RACE</span>`
      : `<span class="source-badge criterium">CRITERIUM</span>`;

    let kits = '';
    if (isRace) {
      if (p.distance) kits += `<span class="kit-item">📏 ${p.distance}</span>`;
      if (p.eventShirt) kits += `<span class="kit-item">👕 Shirt: ${p.eventShirt}</span>`;
      if (p.singlet) kits += `<span class="kit-item">🎽 Singlet: ${p.singlet}</span>`;
    } else {
      if (p.shirtSize) kits += `<span class="kit-item">👕 Shirt: ${p.shirtSize}</span>`;
    }

    const claimedInfo = p.claimed
      ? `<div class="claimed-tag">✓ CLAIMED ${p.claimTime ? '· ' + p.claimTime : ''}</div>`
      : '';

    const btnClass = p.claimed ? 'done' : '';
    const btnLabel = p.claimed ? '✓ CLAIMED' : 'CLAIM';
    const btnDisabled = p.claimed ? 'disabled' : '';

    return `
    <div class="p-card ${claimedClass} ${sourceClass}" id="card-${p.bib}">
      <div>
        <div class="p-top">
          <div class="p-bib">#${p.bib}</div>
          <div class="p-name">${p.name}</div>
          ${sourceBadge}
        </div>
        <div class="p-meta">
          ${p.gender ? `<span class="meta-chip"><span class="label">Gender</span>${p.gender}</span>` : ''}
          ${p.category ? `<span class="meta-chip"><span class="label">Cat</span>${p.category}</span>` : ''}
          ${p.team ? `<span class="meta-chip"><span class="label">Team</span>${p.team}</span>` : ''}
        </div>
        <div class="p-kits">${kits}</div>
        ${claimedInfo}
      </div>
      <button class="claim-btn ${btnClass}" ${btnDisabled} onclick="claimKit('${p.bib}')">${btnLabel}</button>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════
//  CLAIM
// ═══════════════════════════════════════════════
async function claimKit(bib) {
  const p = participants[bib];
  if (!p) return;
  if (p.claimed) { showToast('Already claimed!', 'warning'); return; }

  const now = new Date();
  const claimTime = now.toISOString().replace('T',' ').slice(0,19);
  const staff = document.getElementById('staffInput').value.trim() || 'Unknown';

  // Update locally
  p.claimed = true;
  p.claimTime = claimTime;
  await txPut(STORE_PARTICIPANTS, p);

  // Queue for sync
  const entry = { bib, kitClaiming: 'YES', kitTime: claimTime, staff, source: p.source };
  queue.push(entry);
  await saveQueue();

  updateUI();
  renderResults(getResults());
  showToast(`✓ Kit claimed for #${bib} ${p.name}`, 'success');

  // Auto-sync if online
  if (navigator.onLine) autoSync();
}

// ═══════════════════════════════════════════════
//  SYNC
// ═══════════════════════════════════════════════
function openSyncModal() {
  const sub = document.getElementById('syncSubtitle');
  sub.textContent = `${queue.length} pending claim(s) will be pushed to Google Sheets.`;
  document.getElementById('syncLog').style.display = 'none';
  document.getElementById('syncLog').innerHTML = '';
  document.getElementById('syncConfirmBtn').disabled = false;
  document.getElementById('syncConfirmBtn').textContent = 'Push to Sheets';
  document.getElementById('syncModal').classList.add('open');
}

function closeSyncModal() {
  document.getElementById('syncModal').classList.remove('open');
}

async function runSync() {
  if (!gasUrl) { showToast('Set GAS URL in Config first.', 'warning'); closeSyncModal(); toggleConfig(); return; }
  if (!navigator.onLine) { showToast('You are offline.', 'error'); return; }
  if (!queue.length) { showToast('No pending claims to sync.', 'info'); closeSyncModal(); return; }

  const log = document.getElementById('syncLog');
  log.style.display = 'block';
  const btn = document.getElementById('syncConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';

  const staff = document.getElementById('staffInput').value.trim() || 'Unknown';
  const toSync = [...queue];
  const failed = [];

  for (const entry of toSync) {
    try {
      const res = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim', ...entry, staff })
      });
      const result = await res.json();
      if (result.status === 'ok') {
        appendLog(log, `✓ Bib #${entry.bib} synced`, 'log-ok');
      } else if (result.status === 'already_claimed') {
        appendLog(log, `⚠ Bib #${entry.bib} already claimed on server`, 'log-warn');
      } else {
        appendLog(log, `✗ Bib #${entry.bib}: ${result.message || 'Error'}`, 'log-err');
        failed.push(entry);
      }
    } catch(e) {
      appendLog(log, `✗ Bib #${entry.bib}: Network error`, 'log-err');
      failed.push(entry);
    }
  }

  queue = failed;
  await saveQueue();
  updateUI();
  appendLog(log, `Done. ${toSync.length - failed.length} synced, ${failed.length} failed.`, '');
  btn.textContent = 'Done';
  document.getElementById('syncSubtitle').textContent = `${failed.length} claim(s) remaining.`;
}

async function autoSync() {
  if (!gasUrl || !navigator.onLine || !queue.length) return;
  const staff = document.getElementById('staffInput').value.trim() || 'Auto';
  const toSync = [...queue];
  const failed = [];

  for (const entry of toSync) {
    try {
      const res = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim', ...entry, staff })
      });
      const result = await res.json();
      if (result.status === 'ok' || result.status === 'already_claimed') {
        // success
      } else { failed.push(entry); }
    } catch { failed.push(entry); }
  }

  const synced = toSync.length - failed.length;
  queue = failed;
  await saveQueue();
  updateUI();
  if (synced > 0) showToast(`↑ Auto-synced ${synced} claim(s)`, 'info');
}

function appendLog(el, msg, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ═══════════════════════════════════════════════
//  UI UPDATES
// ═══════════════════════════════════════════════
function updateUI() {
  const list = Object.values(participants);
  const total = list.length;
  const claimed = list.filter(p => p.claimed).length;
  const race = list.filter(p => p.source === 'race').length;
  const crit = list.filter(p => p.source === 'criterium').length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statClaimed').textContent = claimed;
  document.getElementById('statRace').textContent = race;
  document.getElementById('statCrit').textContent = crit;

  const statsBar = document.getElementById('statsBar');
  const fetchBanner = document.getElementById('fetchBanner');
  if (total > 0) {
    statsBar.style.display = 'grid';
    fetchBanner.style.display = 'none';
  } else {
    statsBar.style.display = 'none';
    fetchBanner.style.display = 'flex';
  }

  const badge = document.getElementById('queueBadge');
  badge.textContent = queue.length;
  badge.style.display = queue.length > 0 ? 'inline' : 'none';

  const syncBtn = document.getElementById('syncBtn');
  syncBtn.disabled = queue.length === 0;
}

// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
function toggleConfig() {
  const s = document.getElementById('configSection');
  s.classList.toggle('visible');
}

function saveConfig() {
  const val = document.getElementById('gasUrlInput').value.trim();
  gasUrl = val;
  localStorage.setItem('gasUrl', val);
  showToast('GAS URL saved ✓', 'success');
  document.getElementById('configSection').classList.remove('visible');
}

// ═══════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════
let toastTimeout;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { t.className = ''; }, 3000);
}

// ═══════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════
init();