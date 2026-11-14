/* هريم — rental, repair and debt ledger for a construction-tools shop.
   Vanilla JS, no build step. All data stays on the phone (IndexedDB). */
'use strict';

const VERSION = '1.0.4';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
// Arabic-Indic (٠-٩) and Persian/Kurdish (۰-۹) digits → 0-9, so any phone keyboard works
const latinDigits = (s) => String(s ?? '')
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0));
const toInt = (s) => { const n = parseInt(latinDigits(s).replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
const byId = (arr, id) => arr.find((x) => x.id === id);

// loose matching for search: ignores diacritics and Arabic/Kurdish letter variants
const norm = (s) => latinDigits(s).toLowerCase()
  .replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/[يىیێ]/g, 'ي')
  .replace(/[كک]/g, 'ك')
  .replace(/[ةەھ]/g, 'ه')
  .replace(/ۆ/g, 'و')
  .replace(/ڕ/g, 'ر')
  .replace(/ڵ/g, 'ل')
  .replace(/\s+/g, ' ')
  .trim();

/* ================= language & formatting ================= */
let lang = 'ar';
const L = () => window.I18N[lang];
function t(key, vars) {
  let s = L()[key] ?? window.I18N.ar[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const num = (n) => { const v = Math.round(n || 0); return v < 0 ? `\u200E${nf.format(v)}` : nf.format(v); };
const money = (n, cls = '') => `<span class="money ${cls}"><bdi>${num(n)}</bdi> <span class="cur">${t('currency')}</span></span>`;
const moneyText = (n) => `${num(n)}\u00A0${t('currency')}`;
function compact(n) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} ${t('million')}`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} ${t('thousand')}`;
  return String(Math.round(n));
}
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', lang === 'ku' ? 'ckb' : 'ar');

/* dates are stored as local "YYYY-MM-DD" strings */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
const daysBetween = (a, b) => Math.round(dayNum(b) - dayNum(a));
const rentDays = (a, b) => Math.max(1, daysBetween(a, b));
// long: with weekday and year; long === 'noyear': weekday without the year (home header)
function fmtDate(s, long) {
  if (!s) return '';
  const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1, d = +s.slice(8, 10);
  const M = L().months[m];
  const withYear = long === 'noyear' ? false : long || y !== new Date().getFullYear();
  let out = lang === 'ku'
    ? (withYear ? `${d}ی ${M}ی ${y}` : `${d}ی ${M}`)
    : (withYear ? `${d} ${M} ${y}` : `${d} ${M}`);
  if (long) out = `${L().weekdays[new Date(Date.UTC(y, m, d)).getUTCDay()]}، ${out}`;
  return out;
}

// 12-hour clock with the standard local words for morning/afternoon: 4:05 م / 4:05 د.ن
function fmtTime(ms, seconds = false) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}\u00A0${h < 12 ? t('am') : t('pm')}`;
}
const realTime = (at) => at > 1e12;
// a record's date, plus the exact time when it was entered on that same day (a back-dated record has no known time)
const when = (date, at, long) => (date ? `${fmtDate(date, long)}${realTime(at) && ymd(new Date(at)) === date ? ` · ${fmtTime(at, !!long)}` : ''}` : '');
// the exact moment something was done, to the second
const stamp = (at) => `${fmtDate(ymd(new Date(at)), true)} · ${fmtTime(at, true)}`;

/* ================= icons (Lucide, ISC) ================= */
const ICONS = {
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  hammer: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  cloud: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  backspace: '<path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><path d="m12 9 6 6"/><path d="m18 9-6 6"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

function avatar(name, size = '') {
  const s = String(name || '?').trim();
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return `<span class="avatar ${size} av-${h % 6}" aria-hidden="true">${esc([...s][0] || '?')}</span>`;
}

// a product's picture, or the package icon when it has none
const eqThumb = (photo, size = '') => (photo
  ? `<img class="thumb ${size}" src="${esc(photo)}" alt="">`
  : `<span class="hist-ic rent thumb ${size}">${icon('package')}</span>`);
function miniThumbs(r) {
  const photos = r.items.map(itemPhoto).filter(Boolean).slice(0, 6);
  return photos.length ? `<div class="mini-thumbs">${photos.map((p) => `<img src="${esc(p)}" alt="">`).join('')}</div>` : '';
}
// Pictures are shrunk before saving, so hundreds of them still fit in the phone's storage and in one backup file.
const PHOTO_MAX = 480;
async function photoToDataUrl(file) {
  let source, width, height, release;
  try {
    source = await createImageBitmap(file);
    width = source.width;
    height = source.height;
    release = () => source.close();
  } catch (err) {
    const url = URL.createObjectURL(file);
    release = () => URL.revokeObjectURL(url);
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { release(); reject(new Error('not an image')); };
      img.src = url;
    });
    width = source.naturalWidth;
    height = source.naturalHeight;
  }
  const scale = Math.min(1, PHOTO_MAX / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // transparent pictures get a white background in JPEG
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  release();
  return canvas.toDataURL('image/jpeg', 0.72);
}

/* ================= storage (IndexedDB, localStorage fallback) ================= */
const DEFAULT_SETTINGS = { lang: null, shopName: 'هريم', theme: 'auto', lastBackup: null };
const fresh = () => ({ v: 1, savedAt: 0, equipment: [], customers: [], rentals: [], repairs: [], ledger: [], log: [], settings: { ...DEFAULT_SETTINGS } });
let db = fresh();

function normalizeDb(x) {
  const d = fresh();
  if (!x || typeof x !== 'object') return d;
  for (const k of ['equipment', 'customers', 'rentals', 'repairs', 'ledger', 'log']) if (Array.isArray(x[k])) d[k] = x[k];
  d.settings = { ...DEFAULT_SETTINGS, ...(x.settings || {}) };
  d.savedAt = x.savedAt || 0;
  return d;
}
const hasData = () => ['equipment', 'customers', 'rentals', 'repairs', 'ledger'].some((k) => db[k].length);

const IDB = { name: 'daftar-mahal', store: 'kv', key: 'db', revKey: 'rev' };
const LS_KEY = 'daftar-mahal.db';
const STALE = new Error('stale');
let idbConn = null;
// Revision of the stored data this window last read or wrote. A browser tab left open next to the
// installed app holds an old copy in memory; the revision stops it from overwriting newer data.
let storeRev = 0;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(IDB.name) : null;

function idb() {
  if (!idbConn) {
    idbConn = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB.store);
      req.onsuccess = () => {
        const conn = req.result;
        conn.onclose = () => { idbConn = null; };
        conn.onversionchange = () => { conn.close(); idbConn = null; };
        resolve(conn);
      };
      req.onerror = () => { idbConn = null; reject(req.error); };
    });
  }
  return idbConn;
}
// phones can drop the connection while the app sleeps: retry once on a new one
async function withConn(fn) {
  try {
    return await fn(await idb());
  } catch (err) {
    if (err === STALE) throw err;
    idbConn = null;
    return fn(await idb());
  }
}
const readStore = (conn) => new Promise((resolve, reject) => {
  const os = conn.transaction(IDB.store).objectStore(IDB.store);
  const data = os.get(IDB.key), rev = os.get(IDB.revKey);
  rev.onsuccess = () => resolve({ data: data.result, rev: rev.result || 0 });
  rev.onerror = () => reject(rev.error);
});
const putStore = (conn) => new Promise((resolve, reject) => {
  const tx = conn.transaction(IDB.store, 'readwrite');
  const os = tx.objectStore(IDB.store);
  const rev = os.get(IDB.revKey);
  let next = null;
  rev.onsuccess = () => {
    if ((rev.result || 0) !== storeRev) return; // another window saved newer data: write nothing
    next = storeRev + 1;
    os.put(db, IDB.key);
    os.put(next, IDB.revKey);
  };
  tx.oncomplete = () => {
    if (next == null) { reject(STALE); return; }
    storeRev = next;
    resolve();
  };
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});
async function loadDb() {
  let stored = null;
  try {
    const { data, rev } = await withConn(readStore);
    stored = data || null;
    storeRev = rev;
  } catch (err) {
    console.warn('IndexedDB unavailable, using localStorage', err);
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const copy = JSON.parse(raw);
      if (!stored || (copy.savedAt || 0) > (stored.savedAt || 0)) stored = copy;
    }
  } catch (err) { /* ignore */ }
  return normalizeDb(stored);
}
// writes run one after another; each one saves the latest state
let writeChain = Promise.resolve();
async function doWrite() {
  try {
    await withConn(putStore);
    channel?.postMessage('saved');
    try { localStorage.removeItem(LS_KEY); } catch (err) { /* ignore */ }
  } catch (err) {
    if (err === STALE) { await syncFromStore(true); return; }
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (err2) { toast(t('save_failed')); }
  }
}
function writeDb() {
  db.savedAt = Date.now();
  writeChain = writeChain.then(doWrite);
  return writeChain;
}
const persist = writeDb;
// another window saved newer data: adopt it (also checked whenever this window comes back into view)
async function syncFromStore(afterConflict) {
  let stored;
  try { stored = await withConn(readStore); } catch (err) { return; }
  if (!stored.data || stored.rev === storeRev) return;
  storeRev = stored.rev;
  db = normalizeDb(stored.data);
  lang = db.settings.lang || lang;
  applyTheme();
  await closeAll();
  if ($('#app').hidden) {
    if (db.settings.lang && !locked) { $('#screen').innerHTML = ''; startApp(); }
    return;
  }
  render();
  if (afterConflict) toast(t('data_reloaded'));
}
let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { navigator.storage?.persist?.().catch(() => {}); } catch (err) { /* ignore */ }
}
function commit(msg) {
  persist();
  askPersist();
  render();
  if (msg) toast(msg);
}

/* ================= domain ================= */
const custName = (id) => byId(db.customers, id)?.name || '—';
const itemName = (it) => byId(db.equipment, it.equipmentId)?.name || it.name || t('no_name');
const itemPhoto = (it) => byId(db.equipment, it.equipmentId)?.photo || '';
const eqName = (e) => e.name || t('no_name');
const devName = (p) => p.device || t('no_name');
const isOpen = (r) => !r.returnDate;
const dailyOf = (r) => r.items.reduce((s, it) => s + it.qty * it.rate, 0);
const accrued = (r) => dailyOf(r) * rentDays(r.start, today());
// what is still owed on a closed record (negative = customer paid more)
const rentalDue = (r) => (isOpen(r) ? 0 : (r.total || 0) - (r.advance || 0) - (r.paidAtReturn || 0));
const repairDue = (p) => (p.status === 'delivered' ? (p.price || 0) - (p.paid || 0) : 0);
const itemsText = (r) => r.items.map((i) => `${esc(itemName(i))} ×${i.qty}`).join(' · ');

function balances() {
  const m = new Map();
  const add = (id, v) => m.set(id, (m.get(id) || 0) + v);
  for (const r of db.rentals) if (!isOpen(r)) add(r.customerId, rentalDue(r));
  for (const p of db.repairs) if (p.status === 'delivered') add(p.customerId, repairDue(p));
  for (const e of db.ledger) add(e.customerId, e.type === 'debt' ? e.amount : -e.amount);
  return m;
}
function rentedQty(eqId, exceptRentalId) {
  let n = 0;
  for (const r of db.rentals) {
    if (!isOpen(r) || r.id === exceptRentalId) continue;
    for (const it of r.items) if (it.equipmentId === eqId) n += it.qty;
  }
  return n;
}
/* every action is written down with the exact moment it happened. Names are copied so deleted records still read
   well; a missing name is kept empty and shown in the language in use when the log is read. */
const LOG_MAX = 20000; // a few MB at most; the dates and times on the records themselves are kept forever
function logAction(k, extra = {}) {
  const e = { at: Date.now(), k };
  for (const [key, v] of Object.entries(extra)) if (v !== '' && v != null) e[key] = v;
  db.log.push(e);
  if (db.log.length > LOG_MAX) db.log.splice(0, db.log.length - LOG_MAX);
}
const logCust = (cid) => ({ c: cid, cn: byId(db.customers, cid)?.name });
const logRental = (k, r, extra) => logAction(k, { r: r.id, ...logCust(r.customerId), i: r.items.map((it) => [byId(db.equipment, it.equipmentId)?.name || it.name || '', it.qty]), ...extra });
const logRepair = (k, p, extra) => logAction(k, { r: p.id, ...logCust(p.customerId), x: [p.device, p.problem].filter(Boolean).join(' · '), ...extra });
const logLedger = (k, e) => logAction(k, { r: e.id, t: e.type, ...logCust(e.customerId), n: e.note, a: e.amount });
const LOG_THING = /^(repair|ready|deliver|eq_)/;
// the customer's name as it is now, or as it was if they were deleted
function logWho(e, people) {
  const c = e.c && (people ? people.get(e.c) : byId(db.customers, e.c));
  return c ? c.name || '—' : e.cn || '';
}
const logWhat = (e) => (e.i ? e.i.map(([n, q]) => `${n || t('no_name')}\u00A0×${q}`).join(' · ') : LOG_THING.test(e.k) ? e.x || t('no_name') : '');
// a record's content in a fixed form (sorted keys, empty values and bookkeeping times left out),
// so saving a form without changing anything does not count as an edit
function canonRec(v) {
  if (Array.isArray(v)) return v.map(canonRec);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const k of Object.keys(v).sort()) {
    const c = canonRec(v[k]);
    if (k !== 'updatedAt' && k !== 'editedAt' && c !== '' && c != null && c !== 0 && c !== false) o[k] = c;
  }
  return o;
}
const recSig = (x) => JSON.stringify(canonRec(x));
const LOG_TITLES = {
  rent: 'new_rental', return: 'return_title', return_part: 'log_return_part', rent_edit: 'edit_rental', rent_del: 'log_rent_del',
  repair: 'new_repair', ready: 'marked_ready', deliver: 'deliver_title', repair_edit: 'edit_repair', repair_del: 'log_repair_del',
  pay: 'record_payment', debt: 'add_debt', eq_new: 'new_equipment', eq_edit: 'edit_equipment', eq_del: 'log_eq_del',
  cust_new: 'new_customer', cust_edit: 'edit_customer', cust_del: 'log_cust_del', backup: 'log_backup', restore: 'restore_confirm_title', wipe: 'wipe',
};
function logTitle(e) {
  if (e.k === 'ledger_edit') return t(e.t === 'pay' ? 'edit_payment' : 'edit_debt');
  if (e.k === 'ledger_del') return t(e.t === 'pay' ? 'log_pay_del' : 'log_debt_del');
  return t(LOG_TITLES[e.k] || e.k);
}
const LOG_TARGET = { rent: 'rental', return: 'rental', return_part: 'rental', rent_edit: 'rental', repair: 'repair', ready: 'repair', deliver: 'repair', repair_edit: 'repair', pay: 'ledger', debt: 'ledger', ledger_edit: 'ledger', eq_new: 'equipment', eq_edit: 'equipment', cust_new: 'customer', cust_edit: 'customer' };
const LOG_GROUPS = { rentals: /^(rent|return)/, repairs: /^(repair|ready|deliver)/, money: /^(pay|debt|ledger)/ };
const hasRecords = (cid) => db.rentals.some((r) => r.customerId === cid) || db.repairs.some((p) => p.customerId === cid) || db.ledger.some((e) => e.customerId === cid);

function monthRange(offset) {
  const d = new Date();
  const s = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  return [ymd(s), ymd(new Date(s.getFullYear(), s.getMonth() + 1, 0))];
}
function periodRange(p) {
  if (p === 'month') return monthRange(0);
  if (p === 'last') return monthRange(-1);
  if (p === 'year') { const y = new Date().getFullYear(); return [`${y}-01-01`, `${y}-12-31`]; }
  return null;
}
const inRange = (s, R) => !!s && (!R || (s >= R[0] && s <= R[1]));

function stats(R) {
  const s = { rent: 0, rentN: 0, rev: 0, parts: 0, repN: 0, cash: 0 };
  for (const r of db.rentals) {
    if (inRange(r.start, R)) s.cash += r.advance || 0;
    if (!isOpen(r) && inRange(r.returnDate, R)) { s.rent += r.total || 0; s.rentN++; s.cash += r.paidAtReturn || 0; }
  }
  for (const p of db.repairs) {
    if (p.status === 'delivered' && inRange(p.dateOut, R)) { s.rev += p.price || 0; s.parts += p.parts || 0; s.repN++; s.cash += p.paid || 0; }
  }
  for (const e of db.ledger) if (e.type === 'pay' && inRange(e.date, R)) s.cash += e.amount;
  s.profit = s.rev - s.parts;
  s.net = s.rent + s.profit;
  return s;
}
function lastMonths(n) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const s = stats([ymd(d), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))]);
    out.push({ y: d.getFullYear(), m: d.getMonth(), rent: s.rent, profit: s.profit });
  }
  return out;
}
function topEquipment(R) {
  const m = new Map();
  for (const r of db.rentals) {
    if (isOpen(r) || !inRange(r.returnDate, R)) continue;
    const base = dailyOf(r) || 1;
    for (const it of r.items) {
      const cur = m.get(it.equipmentId) || { name: itemName(it), photo: itemPhoto(it), v: 0 };
      cur.v += ((r.total || 0) * it.qty * it.rate) / base; // share of a discounted total
      m.set(it.equipmentId, cur);
    }
  }
  return [...m.values()].filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
}

/* ================= navigation & overlays ================= */
const TABS = ['home', 'rentals', 'repairs', 'debts', 'more'];
const PARENT = { equipment: 'more', customers: 'more', reports: 'more', activity: 'more', settings: 'more', customer: 'debts' };
const ui = { seg: { rentals: 'open', repairs: 'pending', period: 'month', activity: 'all' }, q: {}, limit: {}, chartSel: null };
let route = { name: 'home', arg: null };
let locked = false;

function parseRoute() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : null };
}
// History: home is the bottom entry (i: 0) and one tab sits above it, so the phone's back button
// goes tab -> home -> out of the app. Sub-pages and sheets push on top.
let goingHome = false;
function showHome() {
  goingHome = false;
  history.replaceState({ d: 0, i: 0 }, '', '#/home');
  route = parseRoute();
  render(true);
}
function goTab(name) {
  const i = history.state?.i || 0;
  if (name === 'home' && i > 0) {
    goingHome = true;
    history.go(-i);
    setTimeout(() => { if (goingHome) showHome(); }, 600);
    return;
  }
  if (name !== 'home' && i === 0 && route.name === 'home') history.pushState({ d: 0, i: 1 }, '', `#/${name}`);
  else history.replaceState({ d: 0, i }, '', `#/${name}`);
  route = parseRoute();
  render(true);
}
function goPage(name, arg) {
  history.pushState({ d: (history.state?.d || 0) + 1, i: (history.state?.i || 0) + 1 }, '', `#/${name}${arg ? `/${encodeURIComponent(arg)}` : ''}`);
  route = parseRoute();
  render(true);
}
function goBack() {
  if ((history.state?.d || 0) > 0) history.back();
  else goTab(PARENT[route.name] || 'home');
}

// every sheet/dialog owns one history entry, so the phone's back button closes it
const overlays = [];
let closing = null; // the close in progress: a second tap must not go back twice
let finishClosing = null;
function pushOverlay(el, onClose) {
  $('#overlays').append(el);
  history.pushState({ d: history.state?.d || 0, i: (history.state?.i || 0) + 1, ov: overlays.length + 1 }, '', location.href);
  const overlay = { el, onClose, isDirty: null };
  overlays.push(overlay);
  document.body.classList.add('has-overlay');
  el.getBoundingClientRect(); // commit initial styles so the open transition runs
  el.classList.add('open');
  return overlay;
}
function closeTopOverlay() {
  const o = overlays.pop();
  if (!o) return;
  o.el.classList.remove('open');
  o.el.classList.add('closing');
  setTimeout(() => o.el.remove(), 320);
  if (!overlays.length) document.body.classList.remove('has-overlay');
  o.onClose?.();
  finishClosing?.();
}
function closeOverlay() {
  if (!overlays.length) return Promise.resolve();
  if (closing) return closing;
  closing = new Promise((resolve) => {
    // if the back navigation never arrives (unusual history state), close anyway
    const timer = setTimeout(closeTopOverlay, 700);
    finishClosing = () => {
      clearTimeout(timer);
      closing = null;
      finishClosing = null;
      resolve();
    };
    history.back();
  });
  return closing;
}
async function closeAll() { while (overlays.length) await closeOverlay(); }
// a user asked to close (X, tap outside, back button): typed input is never dropped without asking
async function requestClose() {
  const top = overlays[overlays.length - 1];
  if (!top || closing) return;
  if (top.isDirty?.()) {
    const ok = await confirmBox({ title: t('discard_title'), message: t('discard_msg'), ok: t('discard_ok'), no: t('discard_no'), danger: true });
    if (!ok) return;
  }
  await closeOverlay();
}

window.addEventListener('popstate', () => {
  if (overlays.length) {
    if (!closing && overlays[overlays.length - 1].isDirty?.()) {
      history.pushState({ d: history.state?.d || 0, i: (history.state?.i || 0) + 1, ov: overlays.length }, '', location.href);
      requestClose();
      return;
    }
    closeTopOverlay();
    return;
  }
  if ($('#app').hidden) return;
  if (goingHome) { showHome(); return; }
  route = parseRoute();
  render(); // the browser restores the scroll position of the page we came back to
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlays.length && !locked) requestClose(); });

const formState = (form) => JSON.stringify([...new FormData(form).entries()]);
function sheet({ title, body, foot = '', cls = '', onMount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = `ov ov-sheet ${cls}`;
  wrap.innerHTML = `<div class="scrim" data-close></div>
    <form class="sheet" novalidate autocomplete="off" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="${t('close')}">${icon('x')}</button></header>
      <div class="sheet-body">${body}</div>
      ${foot ? `<footer class="sheet-foot">${foot}</footer>` : ''}
    </form>`;
  const form = $('form', wrap);
  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { e.preventDefault(); requestClose(); return; }
    const go = e.target.closest('[data-go-customer]');
    if (go) {
      e.preventDefault();
      await closeAll();
      if (route.name !== 'customer' || route.arg !== go.dataset.goCustomer) goPage('customer', go.dataset.goCustomer);
    }
  });
  // Enter moves to the next field: a form is only saved with its button
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input, select')) return;
    e.preventDefault();
    const fields = $$('input:not([type=hidden]), select, textarea', form).filter((f) => f.offsetParent !== null);
    const next = fields[fields.indexOf(e.target) + 1];
    if (next) next.focus(); else e.target.blur();
  });
  const overlay = pushOverlay(wrap, onClose);
  onMount?.(form, wrap);
  if ($('[type=submit]', form)) {
    const clean = formState(form);
    overlay.isDirty = () => formState(form) !== clean;
  }
  return form;
}
// a second tap while saving must not create a second record
function onSubmit(form, handler) {
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || form.closest('.closing')) return;
    busy = true;
    try { await handler(e); } finally { busy = false; }
  });
}

function confirmBox({ title, message = '', ok, no, danger = false, onYes }) {
  return new Promise((resolve) => {
    let yes = false;
    const wrap = document.createElement('div');
    wrap.className = 'ov ov-dialog';
    wrap.innerHTML = `<div class="scrim" data-no></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ''}
        <div class="dialog-actions"><button type="button" class="btn btn-ghost" data-no>${esc(no || t('cancel'))}</button>
        <button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-yes>${esc(ok || t('confirm'))}</button></div>
      </div>`;
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-yes]')) {
        yes = true;
        onYes?.(); // runs inside the tap: phones only open a file picker from a direct tap
        closeOverlay();
      } else if (e.target.closest('[data-no]')) closeOverlay();
    });
    pushOverlay(wrap, () => resolve(yes));
    setTimeout(() => $('[data-yes]', wrap)?.focus({ preventScroll: true }), 60);
  });
}
const confirmDelete = () => confirmBox({ title: t('confirm_delete_title'), message: t('confirm_delete_msg'), ok: t('yes_delete'), danger: true });

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ================= shared UI pieces ================= */
const fabBtn = (act, label) => `<button class="fab" data-act="${act}">${icon('plus')}<span>${label}</span></button>`;
const emptyInline = (txt) => `<div class="card empty-inline">${txt}</div>`;
const emptyState = (ic, title, text = '', action = '', cls = '') =>
  `<div class="empty ${cls}"><span class="ei">${icon(ic)}</span><b>${title}</b>${text ? `<p>${text}</p>` : ''}${action}</div>`;
const searchBox = (key) => `<div class="search">${icon('search')}<input class="input" type="search" data-search="${key}" value="${esc(ui.q[key] || '')}" placeholder="${t('search')}" enterkeyhint="search" aria-label="${t('search')}"></div>`;
const segCtl = (key, opts) => `<div class="seg${opts.length > 3 ? ' dense' : ''}" role="group">${opts.map(([v, label, n]) =>
  `<button type="button" data-act="seg" data-key="${key}" data-val="${v}" aria-pressed="${ui.seg[key] === v}">${label}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;
const langButton = () => `<button class="lang-btn" data-act="toggle-lang" aria-label="${t('change_lang')}">${icon('languages')}${lang === 'ar' ? 'کوردی' : 'العربية'}</button>`;
const optLabel = () => ` <span class="opt">(${t('optional')})</span>`;
// long lists render in steps so years of records stay fast on a phone
const LIST_STEP = 50;
function paged(key, rows, card) {
  const limit = ui.limit[key] || LIST_STEP;
  const html = rows.slice(0, limit).map((row) => card(row)).join('');
  return rows.length > limit ? `${html}<button class="btn btn-ghost btn-block" data-act="more" data-key="${esc(key)}">${t('show_more')} (${rows.length - limit})</button>` : html;
}
const resultBox = (kind, ic, text, amount) => `<div class="result ${kind}">${icon(ic)}<span class="r-text">${text}</span>${amount != null ? money(amount) : ''}</div>`;

function moneyInput(name, value, { id, label } = {}) {
  return `<div class="money-input"><input class="input" name="${name}" ${id ? `id="${id}"` : ''} inputmode="numeric" data-money value="${value ? num(value) : ''}" placeholder="0" dir="ltr" autocomplete="off"${label ? ` aria-label="${esc(label)}"` : ''}><span class="cur">${t('currency')}</span></div>`;
}
function clearErrs(form) { $$('[data-err]', form).forEach((el) => { el.hidden = true; el.textContent = ''; }); }
function showErr(form, key, msg) {
  const el = $(`[data-err="${key}"]`, form);
  if (el) { el.textContent = msg; el.hidden = false; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else toast(msg);
  try { navigator.vibrate?.(60); } catch (err) { /* ignore */ }
}

/* customer picker: type a name, pick an existing customer, or a new one is created on save */
function customerField(cid) {
  const c = cid ? byId(db.customers, cid) : null;
  return `<div class="field combo">
    <label for="f-cname">${t('customer')}${optLabel()}</label>
    <div class="combo-box">
      <span class="combo-ic">${icon('user')}</span>
      <input class="input" id="f-cname" name="customerName" value="${esc(c?.name || '')}" placeholder="${t('customer_ph')}" autocomplete="off" enterkeyhint="next" maxlength="60" role="combobox" aria-expanded="false" aria-autocomplete="list">
      <input type="hidden" name="customerId" value="${esc(c?.id || '')}">
      <div class="combo-list" role="listbox" hidden></div>
    </div>
    <div class="combo-new" hidden>
      <label class="label" for="f-cphone">${t('new_customer_phone')}${optLabel()}</label>
      <input class="input ltr-input" id="f-cphone" name="customerPhone" type="tel" inputmode="tel" placeholder="07xx xxx xxxx" maxlength="20">
    </div>
  </div>`;
}
function bindCustomerField(form, onChange, debtorsFirst = false) {
  const inp = form.elements.customerName, hid = form.elements.customerId;
  const list = $('.combo-list', form), newBox = $('.combo-new', form);
  const bal = balances();
  const show = () => {
    const raw = inp.value.trim(), q = norm(raw);
    const digits = latinDigits(raw).replace(/\D/g, '');
    let rows = q ? db.customers.filter((c) => norm(c.name).includes(q) || (digits.length > 2 && latinDigits(c.phone || '').includes(digits))) : db.customers.slice();
    rows.sort(debtorsFirst ? (a, b) => (bal.get(b.id) || 0) - (bal.get(a.id) || 0) || byName(a, b) : byName);
    rows = rows.slice(0, 6);
    const exact = db.customers.some((c) => norm(c.name) === q);
    let html = rows.map((c) => {
      const b = bal.get(c.id) || 0;
      return `<button type="button" class="combo-opt" role="option" data-cid="${c.id}">${avatar(c.name, 'sm')}<span class="co-name">${esc(c.name)}</span>${b > 0 ? `<span class="chip chip-bad">${moneyText(b)}</span>` : ''}</button>`;
    }).join('');
    if (q && !exact) html += `<button type="button" class="combo-opt combo-add" role="option" data-new><span class="plus">${icon('plus')}</span><span class="co-name">${t('new_customer_named', { name: esc(raw) })}</span></button>`;
    list.innerHTML = html;
    list.hidden = !html || document.activeElement !== inp;
    inp.setAttribute('aria-expanded', String(!list.hidden));
  };
  const sync = () => {
    const q = norm(inp.value);
    const sel = hid.value && byId(db.customers, hid.value);
    if (sel && norm(sel.name) !== q) hid.value = '';
    if (!hid.value && q) { const m = db.customers.find((c) => norm(c.name) === q); if (m) hid.value = m.id; }
    newBox.hidden = !(q && !hid.value);
    onChange?.(hid.value || null);
  };
  inp.addEventListener('input', () => { sync(); show(); });
  inp.addEventListener('focus', show);
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); }, 250));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input while choosing
  list.addEventListener('click', (e) => {
    const o = e.target.closest('.combo-opt');
    if (!o) return;
    if (o.dataset.cid) { const c = byId(db.customers, o.dataset.cid); inp.value = c.name; hid.value = c.id; }
    list.hidden = true;
    sync();
    if (o.dataset.new != null) form.elements.customerPhone.focus(); else inp.blur();
  });
  sync();
}
// called only after every other check passed, so a failed save never leaves a stray customer
function resolveCustomer(form) {
  const name = form.elements.customerName.value.trim();
  const id = form.elements.customerId.value;
  if (id && byId(db.customers, id)) return id;
  // no name given: such records share one "unnamed customer" account, so any debt stays visible
  const unnamed = [window.I18N.ar.unnamed_customer, window.I18N.ku.unnamed_customer].map(norm);
  const match = name ? db.customers.find((c) => norm(c.name) === norm(name)) : db.customers.find((c) => unnamed.includes(norm(c.name)));
  if (match) return match.id;
  const c = { id: uid(), name: name || t('unnamed_customer'), phone: latinDigits(form.elements.customerPhone?.value || '').trim(), note: '', createdAt: Date.now() };
  db.customers.push(c);
  logAction('cust_new', { r: c.id, ...logCust(c.id) });
  return c.id;
}

/* ================= cards ================= */
function rentalCard(r, inCustomer = false) {
  const name = inCustomer ? t('rental') : custName(r.customerId);
  const lead = inCustomer ? `<span class="hist-ic rent">${icon('hammer')}</span>` : avatar(name);
  const hit = `<button class="rc-hit" data-act="rental" data-id="${r.id}" aria-label="${esc(name)}"></button>`;
  if (isOpen(r)) {
    return `<article class="card rc">${hit}${lead}
      <div class="rc-main">
        <div class="rc-title"><span>${esc(name)}</span></div>
        <div class="rc-sub">${itemsText(r)}</div>${miniThumbs(r)}
        <div class="rc-meta"><span>${icon('calendar')}${when(r.start, r.createdAt)}</span><span>${icon('clock')}${L().since(daysBetween(r.start, today()))}</span></div>
      </div>
      <div class="rc-end"><span class="rc-amount">${money(accrued(r))}</span>
        <button class="btn btn-sm btn-primary" data-act="return" data-id="${r.id}">${t('return_btn')}</button></div>
    </article>`;
  }
  const due = rentalDue(r);
  return `<article class="card rc">${hit}${lead}
    <div class="rc-main">
      <div class="rc-title"><span>${esc(name)}</span></div>
      <div class="rc-sub">${itemsText(r)}</div>${miniThumbs(r)}
      <div class="rc-meta"><span>${icon('calendar')}${fmtDate(r.start)} ← ${when(r.returnDate, r.returnedAt)}</span><span>${icon('clock')}${L().days(r.days)}</span></div>
    </div>
    <div class="rc-end"><span class="rc-amount">${money(r.total)}</span>
      ${due > 0 ? `<span class="chip chip-bad">${t('debt')} ${moneyText(due)}</span>` : `<span class="chip chip-good">${icon('check')}${t('settled')}</span>`}</div>
  </article>`;
}

function repairCard(p, inCustomer = false) {
  const name = inCustomer ? '' : custName(p.customerId);
  let end;
  if (p.status === 'pending') end = `<button class="btn btn-sm btn-ghost" data-act="ready" data-id="${p.id}">${icon('check')}${t('mark_ready')}</button>`;
  else if (p.status === 'ready') end = `<span class="chip chip-warn">${t('st_ready')}</span><button class="btn btn-sm btn-primary" data-act="deliver" data-id="${p.id}">${t('deliver')}</button>`;
  else {
    const due = repairDue(p);
    end = `<span class="rc-amount">${money(p.price)}</span>${due > 0
      ? `<span class="chip chip-bad">${t('debt')} ${moneyText(due)}</span>`
      : `<span class="chip ${(p.price || 0) < (p.parts || 0) ? 'chip-bad' : 'chip-good'}">${t('profit')} ${moneyText((p.price || 0) - (p.parts || 0))}</span>`}`;
  }
  const delivered = p.status === 'delivered';
  return `<article class="card rc"><button class="rc-hit" data-act="repair" data-id="${p.id}" aria-label="${esc(devName(p))}"></button>
    <span class="hist-ic">${icon('wrench')}</span>
    <div class="rc-main">
      <div class="rc-title"><span>${esc(devName(p))}</span></div>
      ${name || p.problem ? `<div class="rc-sub">${[name, p.problem].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
      <div class="rc-meta"><span>${icon('calendar')}${delivered ? when(p.dateOut, p.deliveredAt) : when(p.dateIn, p.createdAt)}</span>${delivered ? '' : `<span>${icon('clock')}${L().since(daysBetween(p.dateIn, today()))}</span>`}</div>
    </div>
    <div class="rc-end">${end}</div>
  </article>`;
}

function customerCard(c, b) {
  return `<article class="card rc"><button class="rc-hit" data-act="customer" data-id="${c.id}" aria-label="${esc(c.name)}"></button>
    ${avatar(c.name)}
    <div class="rc-main"><div class="rc-title"><span>${esc(c.name)}</span></div>
      ${c.phone ? `<div class="rc-meta"><span>${icon('phone')}<bdi>${esc(c.phone)}</bdi></span></div>` : ''}</div>
    <div class="rc-end">${b > 0 ? `<span class="rc-amount bad">${money(b)}</span>` : b < 0 ? `<span class="chip chip-info">${t('credit')}</span>` : ''}</div>
    ${icon('chevron-left', 'chev')}
  </article>`;
}

function equipmentCard(e) {
  const out = rentedQty(e.id);
  const pct = e.total ? Math.min(100, Math.round((out / e.total) * 100)) : 0;
  return `<article class="card rc"><button class="rc-hit" data-act="equipment" data-id="${e.id}" aria-label="${esc(eqName(e))}"></button>
    ${eqThumb(e.photo, 'lg')}
    <div class="rc-main">
      <div class="rc-title"><span>${esc(eqName(e))}</span></div>
      <div class="rc-meta"><span>${t('available_of', { a: e.total - out, t: e.total })}</span>${out ? `<span class="chip chip-brand">${t('rented_out', { n: out })}</span>` : ''}</div>
      <div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div>
    </div>
    <div class="rc-end"><span class="eq-price">${money(e.rate)}</span><span class="eq-per">${t('per_day')}</span></div>
  </article>`;
}

function historyEntries(cid) {
  const out = [];
  for (const r of db.rentals) if (r.customerId === cid && !isOpen(r)) out.push({ date: r.returnDate, kind: 'rental', ref: r });
  for (const p of db.repairs) if (p.customerId === cid && p.status === 'delivered') out.push({ date: p.dateOut, kind: 'repair', ref: p });
  for (const e of db.ledger) if (e.customerId === cid) out.push({ date: e.date, kind: e.type, ref: e });
  const moment = (h) => h.ref.returnedAt || h.ref.deliveredAt || h.ref.createdAt || 0;
  return out.sort((a, b) => b.date.localeCompare(a.date) || moment(b) - moment(a));
}
function histCard(h) {
  const x = h.ref;
  if (h.kind === 'rental') return rentalCard(x, true);
  if (h.kind === 'repair') return repairCard(x, true);
  const pay = h.kind === 'pay';
  return `<article class="card rc"><button class="rc-hit" data-act="ledger" data-id="${x.id}" aria-label="${pay ? t('payment') : t('debt')}"></button>
    <span class="hist-ic ${pay ? 'pay' : 'debt'}">${icon(pay ? 'banknote' : 'plus')}</span>
    <div class="rc-main">
      <div class="rc-title"><span>${pay ? t('payment') : t('debt')}</span></div>
      ${x.note ? `<div class="rc-sub">${esc(x.note)}</div>` : ''}
      <div class="rc-meta"><span>${icon('calendar')}${when(x.date, x.createdAt)}</span></div>
    </div>
    <div class="rc-end"><span class="rc-amount ${pay ? 'good' : 'bad'}">${money(x.amount)}</span></div>
  </article>`;
}

/* ================= pages ================= */
function pageHome() {
  let debt = 0, debtors = 0;
  for (const v of balances().values()) if (v > 0) { debt += v; debtors++; }
  const open = db.rentals.filter(isOpen).sort((a, b) => a.start.localeCompare(b.start));
  const accruedSum = open.reduce((s, r) => s + accrued(r), 0);
  const inShop = db.repairs.filter((p) => p.status !== 'delivered');
  const ready = inShop.filter((p) => p.status === 'ready');
  const st = stats(monthRange(0));
  const html = `
    <button class="hero" data-act="tab" data-tab="debts">
      <span class="hero-label"><span>${t('debts_on_people')}</span>${icon('chevron-left')}</span>
      <span class="hero-value">${money(debt)}</span>
      <span class="hero-sub">${t('debtors_count', { n: debtors })}</span>
    </button>
    <div class="stats">
      <button class="card stat" data-act="tab" data-tab="rentals"><span class="stat-k">${t('open_rentals')}</span><span class="stat-v">${open.length}</span><span class="stat-s">${t('so_far')} ${moneyText(accruedSum)}</span></button>
      <button class="card stat" data-act="tab" data-tab="repairs"><span class="stat-k">${t('in_repair')}</span><span class="stat-v">${inShop.length}</span><span class="stat-s">${t('ready_n', { n: ready.length })}</span></button>
      <button class="card stat" data-act="page" data-page="reports"><span class="stat-k">${t('rent_income')}</span><span class="stat-v">${money(st.rent)}</span><span class="stat-s">${t('p_month')}</span></button>
      <button class="card stat" data-act="page" data-page="reports"><span class="stat-k">${t('repair_profit')}</span><span class="stat-v ${st.profit < 0 ? 'bad' : ''}">${money(st.profit)}</span><span class="stat-s">${t('p_month')}</span></button>
    </div>
    <div class="quick">
      <button data-act="new-rental"><span class="qi">${icon('hammer')}</span>${t('new_rental')}</button>
      <button data-act="new-repair"><span class="qi">${icon('wrench')}</span>${t('new_repair')}</button>
      <button data-act="new-payment"><span class="qi">${icon('banknote')}</span>${t('record_payment')}</button>
    </div>
    ${db.equipment.length ? '' : `<section class="card" style="margin-top:12px">${emptyState('package', t('no_equipment'), t('need_equipment'), `<button class="btn btn-primary" data-act="page" data-page="equipment">${icon('plus')}${t('add_equipment_btn')}</button>`)}</section>`}
    <div class="sec"><h2>${t('open_rentals_list')}</h2>${open.length > 5 ? `<button class="link" data-act="tab" data-tab="rentals">${t('see_all')}${icon('chevron-left')}</button>` : ''}</div>
    ${open.length ? `<div class="list">${open.slice(0, 5).map((r) => rentalCard(r)).join('')}</div>` : emptyInline(t('empty_home_rentals'))}
    ${ready.length ? `<div class="sec"><h2>${t('ready_pickup')}</h2></div><div class="list">${ready.map((p) => repairCard(p)).join('')}</div>` : ''}
    ${db.log.length ? `<div class="sec"><h2>${t('recent_activity')}</h2><button class="link" data-act="page" data-page="activity">${t('see_all')}${icon('chevron-left')}</button></div>
      <div class="log-list">${logBlocks(db.log.slice(-5).reverse())}</div>` : ''}`;
  return { title: db.settings.shopName || t('app_name'), sub: fmtDate(today(), 'noyear'), brand: true, actions: langButton(), html };
}

function dayLabel(d) {
  const ago = daysBetween(d, today());
  return `${ago === 0 ? `${t('today')} · ` : ago === 1 ? `${t('yesterday')} · ` : ''}${fmtDate(d, true)}`;
}
function logRow(e) {
  const target = LOG_TARGET[e.k];
  const list = { rental: db.rentals, repair: db.repairs, ledger: db.ledger, equipment: db.equipment, customer: db.customers }[target];
  const exists = !!(list && byId(list, e.r));
  const sub = [logWho(e), logWhat(e), e.n].filter(Boolean).map(esc).join(' · ');
  const amount = e.a != null ? `<span class="log-amt ${e.k === 'pay' || e.t === 'pay' ? 'good' : e.k === 'debt' || e.t === 'debt' ? 'bad' : ''}">${money(e.a)}</span>` : '';
  const inner = `<span class="log-time">${fmtTime(e.at, true)}</span>
    <span class="log-main">
      <span class="log-head"><span class="log-title">${esc(logTitle(e))}${target && !exists ? ` <span class="chip">${t('log_deleted')}</span>` : ''}</span>${amount}</span>
      ${sub ? `<span class="log-sub">${sub}</span>` : ''}${e.p ? `<span class="log-paid">${t('paid')} ${moneyText(e.p)}</span>` : ''}</span>`;
  return exists ? `<button class="log-row" data-act="log" data-target="${target}" data-id="${esc(e.r)}">${inner}</button>` : `<div class="log-row">${inner}</div>`;
}
// newest first, one card per day
function logBlocks(rows) {
  let html = '', day = null, card = '';
  const flush = () => { if (card) html += `<div class="card log-card">${card}</div>`; card = ''; };
  for (const e of rows) {
    const d = ymd(new Date(e.at));
    if (d !== day) { flush(); day = d; html += `<div class="day-head">${dayLabel(d)}</div>`; }
    card += logRow(e);
  }
  flush();
  return html;
}
let logMemo = new Map();
function logNorm(s) {
  let v = logMemo.get(s);
  if (v === undefined) { v = norm(s); logMemo.set(s, v); }
  return v;
}
function logMatches(e, words, people) {
  const parts = [logTitle(e), logWho(e, people), e.n];
  if (e.i) for (const [n] of e.i) parts.push(n || t('no_name'));
  else if (LOG_THING.test(e.k)) parts.push(e.x || t('no_name'));
  return words.every((w) => parts.some((p) => p && logNorm(p).includes(w)));
}
function listActivity() {
  const q = norm(ui.q.activity || '');
  const group = LOG_GROUPS[ui.seg.activity];
  let rows = db.log.slice().reverse();
  if (group) rows = rows.filter((e) => group.test(e.k));
  if (q.trim()) {
    const people = new Map(db.customers.map((c) => [c.id, c]));
    const words = q.split(/\s+/).filter(Boolean);
    rows = rows.filter((e) => logMatches(e, words, people));
  }
  if (!rows.length) return q.trim() ? emptyInline(t('no_results')) : emptyState('clock', t('no_activity'));
  const limit = ui.limit.activity || LIST_STEP;
  return logBlocks(rows.slice(0, limit)) + (rows.length > limit ? `<button class="btn btn-ghost btn-block" data-act="more" data-key="activity" style="margin-top:12px">${t('show_more')} (${rows.length - limit})</button>` : '');
}
function pageActivity() {
  logMemo = new Map();
  return {
    title: t('activity'), back: true,
    html: `${segCtl('activity', [['all', t('p_all')], ['rentals', t('nav_rentals')], ['repairs', t('nav_repairs')], ['money', t('nav_debts')]])}
      ${searchBox('activity')}<div id="list" class="log-list">${listActivity()}</div>`,
  };
}

function pageRentals() {
  const openN = db.rentals.filter(isOpen).length;
  return {
    title: t('nav_rentals'),
    html: `${segCtl('rentals', [['open', t('seg_open'), openN], ['closed', t('seg_closed'), db.rentals.length - openN]])}
      ${searchBox('rentals')}<div id="list" class="list">${listRentals()}</div>`,
    fab: fabBtn('new-rental', t('new_rental')),
  };
}
function listRentals() {
  const q = norm(ui.q.rentals || '');
  const open = ui.seg.rentals === 'open';
  let rows = db.rentals.filter((r) => isOpen(r) === open);
  if (q) {
    const who = new Map(db.customers.map((c) => [c.id, c.name]));
    const what = new Map(db.equipment.map((e) => [e.id, e.name]));
    rows = rows.filter((r) => norm(`${who.get(r.customerId)} ${r.items.map((i) => what.get(i.equipmentId) || i.name).join(' ')}`).includes(q));
  }
  rows.sort(open ? (a, b) => a.start.localeCompare(b.start) : (a, b) => b.returnDate.localeCompare(a.returnDate) || (b.updatedAt || 0) - (a.updatedAt || 0));
  if (rows.length) return paged(`rentals:${ui.seg.rentals}`, rows, (r) => rentalCard(r));
  if (q) return emptyInline(t('no_results'));
  if (!db.equipment.length) return emptyState('package', t('no_equipment'), t('need_equipment'), `<button class="btn btn-primary" data-act="page" data-page="equipment">${icon('plus')}${t('add_equipment_btn')}</button>`);
  return emptyState('hammer', open ? t('no_open_rentals') : t('no_closed_rentals'));
}

function pageRepairs() {
  const c = { pending: 0, ready: 0, delivered: 0 };
  for (const p of db.repairs) c[p.status]++;
  return {
    title: t('nav_repairs'),
    html: `${segCtl('repairs', [['pending', t('seg_pending'), c.pending], ['ready', t('seg_ready'), c.ready], ['delivered', t('seg_delivered'), c.delivered]])}
      ${searchBox('repairs')}<div id="list" class="list">${listRepairs()}</div>`,
    fab: fabBtn('new-repair', t('new_repair')),
  };
}
function listRepairs() {
  const q = norm(ui.q.repairs || '');
  const st = ui.seg.repairs;
  let rows = db.repairs.filter((p) => p.status === st);
  if (q) {
    const who = new Map(db.customers.map((c) => [c.id, c.name]));
    rows = rows.filter((p) => norm(`${p.device} ${p.problem || ''} ${who.get(p.customerId)}`).includes(q));
  }
  rows.sort(st === 'delivered' ? (a, b) => b.dateOut.localeCompare(a.dateOut) || (b.updatedAt || 0) - (a.updatedAt || 0) : (a, b) => a.dateIn.localeCompare(b.dateIn));
  if (rows.length) return paged(`repairs:${st}`, rows, (p) => repairCard(p));
  return q ? emptyInline(t('no_results')) : emptyState('wrench', t('no_repairs'));
}

function pageDebts() {
  const bal = balances();
  let total = 0, n = 0;
  for (const v of bal.values()) if (v > 0) { total += v; n++; }
  return {
    title: t('nav_debts'),
    html: `<div class="hero"><span class="hero-label"><span>${t('total_debts')}</span>${icon('wallet')}</span>
        <span class="hero-value">${money(total)}</span><span class="hero-sub">${t('debtors_count', { n })}</span></div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-primary" data-act="new-payment">${icon('banknote')}${t('record_payment')}</button>
        <button class="btn btn-ghost" data-act="new-debt">${icon('plus')}${t('add_debt')}</button>
      </div>
      ${n ? searchBox('debts') : ''}<div id="list" class="list"${n ? '' : ' style="margin-top:12px"'}>${listDebts()}</div>`,
  };
}
function listDebts() {
  const bal = balances();
  const q = norm(ui.q.debts || '');
  let rows = db.customers.map((c) => ({ c, b: bal.get(c.id) || 0 })).filter((x) => x.b > 0);
  if (!rows.length) return emptyState('check', t('no_debts_title'), t('no_debts_sub'), '', 'good');
  const digits = latinDigits(ui.q.debts || '').replace(/\D/g, '');
  if (q) rows = rows.filter((x) => norm(x.c.name).includes(q) || (digits.length > 2 && latinDigits(x.c.phone || '').includes(digits)));
  rows.sort((a, b) => b.b - a.b);
  return rows.length ? paged('debts', rows, (x) => customerCard(x.c, x.b)) : emptyInline(t('no_results'));
}

function pageMore() {
  const items = [
    ['equipment', 'package', t('equipment'), t('menu_equipment_hint'), db.equipment.length],
    ['customers', 'users', t('customers'), t('menu_customers_hint'), db.customers.length],
    ['reports', 'chart', t('reports'), t('menu_reports_hint')],
    ['activity', 'clock', t('activity'), t('menu_activity_hint')],
    ['settings', 'settings', t('settings'), t('menu_settings_hint')],
  ];
  const menu = items.map(([p, ic, title, hint, n]) => `<button class="menu-item" data-act="page" data-page="${p}">
      <span class="mi-ic">${icon(ic)}</span><span class="mi-main"><span class="mi-title">${title}</span><span class="mi-hint">${hint}</span></span>
      ${n != null ? `<span class="mi-n">${n}</span>` : ''}${icon('chevron-left', 'chev')}</button>`).join('');
  return { title: t('nav_more'), html: `<div class="card menu menu-card">${menu}</div>${installBlock()}<p class="foot-note">${t('app_name')} · ${t('version')} ${VERSION}</p>` };
}

function pageEquipment() {
  return {
    title: t('equipment'), back: true,
    html: `${db.equipment.length > 5 ? searchBox('equipment') : ''}<div id="list" class="list">${listEquipment()}</div>`,
    fab: fabBtn('new-equipment', t('new_equipment')),
  };
}
function listEquipment() {
  const q = db.equipment.length > 5 ? norm(ui.q.equipment || '') : '';
  let rows = db.equipment.slice().sort(byName);
  if (q) rows = rows.filter((e) => norm(eqName(e)).includes(q));
  if (rows.length) return paged('equipment', rows, (e) => equipmentCard(e));
  return q ? emptyInline(t('no_results')) : emptyState('package', t('no_equipment'), t('need_equipment'));
}

function pageCustomers() {
  return {
    title: t('customers'), back: true,
    html: `${db.customers.length ? searchBox('customers') : ''}<div id="list" class="list">${listCustomers()}</div>`,
    fab: fabBtn('new-customer', t('new_customer')),
  };
}
function listCustomers() {
  const raw = (ui.q.customers || '').trim(), q = norm(raw);
  const digits = latinDigits(raw).replace(/\D/g, '');
  const bal = balances();
  let rows = db.customers.slice();
  if (q) rows = rows.filter((c) => norm(c.name).includes(q) || (digits.length > 2 && latinDigits(c.phone || '').includes(digits)));
  rows.sort(byName);
  if (rows.length) return paged('customers', rows, (c) => customerCard(c, bal.get(c.id) || 0));
  return q ? emptyInline(t('no_results')) : emptyState('users', t('no_customers'));
}

function pageCustomer(id) {
  const c = byId(db.customers, id);
  if (!c) return null;
  const b = balances().get(id) || 0;
  const open = db.rentals.filter((r) => r.customerId === id && isOpen(r));
  const inShop = db.repairs.filter((p) => p.customerId === id && p.status !== 'delivered');
  const hist = historyEntries(id);
  const balHtml = b > 0
    ? `<div class="balance bad"><span class="b-label">${t('owes')}</span><span class="b-value">${money(b)}</span></div>`
    : b < 0
      ? `<div class="balance info"><span class="b-label">${t('credit')}</span><span class="b-value">${money(-b)}</span></div>`
      : `<div class="balance good"><span class="b-label">${icon('check')}${t('no_balance')}</span></div>`;
  const html = `<section class="card profile">
      <div class="profile-top">${avatar(c.name, 'lg')}<div class="pt-main"><div class="pt-name">${esc(c.name)}</div>
        ${c.phone ? `<a class="phone-link" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${icon('phone')}<bdi>${esc(c.phone)}</bdi></a>` : ''}</div></div>
      ${balHtml}
      <div class="btn-row">
        <button class="btn btn-primary" data-act="new-payment" data-cid="${id}">${icon('banknote')}${t('record_payment')}</button>
        <button class="btn btn-ghost" data-act="new-debt" data-cid="${id}">${icon('plus')}${t('add_debt')}</button>
      </div>
      ${c.note ? `<div class="note-box">${esc(c.note)}</div>` : ''}
    </section>
    ${open.length ? `<div class="sec"><h2>${t('with_customer_now')}</h2></div><div class="list">${open.map((r) => rentalCard(r, true)).join('')}</div>` : ''}
    ${inShop.length ? `<div class="sec"><h2>${t('in_shop_now')}</h2></div><div class="list">${inShop.map((p) => repairCard(p, true)).join('')}</div>` : ''}
    <div class="sec"><h2>${t('history')}</h2></div>
    ${hist.length ? `<div class="list">${paged(`hist:${id}`, hist, histCard)}</div>` : emptyInline(t('nothing_yet'))}`;
  return { title: c.name, back: true, actions: `<button class="icon-btn" data-act="edit-customer" data-id="${id}" aria-label="${t('edit_customer')}">${icon('edit')}</button>`, html };
}

function pageReports() {
  const R = periodRange(ui.seg.period);
  const s = stats(R);
  const top = topEquipment(R);
  const topMax = top[0]?.v || 1;
  const html = `${chartHTML(lastMonths(6))}
    <div style="margin-top:22px">${segCtl('period', [['month', t('p_month')], ['last', t('p_last')], ['year', t('p_year')], ['all', t('p_all')]])}</div>
    <section class="card big-stat" style="margin-top:12px">
      <div class="k">${t('net_income')}</div><div class="v">${money(s.net)}</div><div class="s">${t('net_hint')}</div>
    </section>
    <div class="stats">
      <div class="card stat"><span class="stat-k">${t('rent_income')}</span><span class="stat-v">${money(s.rent)}</span><span class="stat-s">${t('rentals_done')}: ${s.rentN}</span></div>
      <div class="card stat"><span class="stat-k">${t('repair_income')}</span><span class="stat-v">${money(s.rev)}</span><span class="stat-s">${t('repairs_done')}: ${s.repN}</span></div>
      <div class="card stat"><span class="stat-k">${t('parts_total')}</span><span class="stat-v">${money(s.parts)}</span></div>
      <div class="card stat"><span class="stat-k">${t('repair_profit')}</span><span class="stat-v ${s.profit < 0 ? 'bad' : ''}">${money(s.profit)}</span></div>
      <div class="card stat" style="grid-column:1/-1"><span class="stat-k">${t('cash_in')}</span><span class="stat-v">${money(s.cash)}</span><span class="stat-s">${t('cash_hint')}</span></div>
    </div>
    <div class="sec"><h2>${t('top_equipment')}</h2></div>
    ${top.length ? `<section class="card rank">${top.map((x) => `<div class="rank-row"><div class="rank-top">${x.photo ? `<img class="rank-thumb" src="${esc(x.photo)}" alt="">` : ''}<b>${esc(x.name)}</b><span>${money(x.v)}</span></div>
      <div class="rank-bar"><i style="width:${Math.max(2, (x.v / topMax) * 100)}%"></i></div></div>`).join('')}</section>` : emptyInline(t('no_data'))}`;
  return { title: t('reports'), back: true, html };
}

const niceCeil = (v) => {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};
function readoutHTML(m) {
  return `<div class="ro-title">${L().months[m.m]} ${m.y}</div>
    <div class="ro-row"><i class="key" style="background:var(--series-1)"></i><span class="lbl">${t('legend_rent')}</span><span class="val">${money(m.rent)}</span></div>
    <div class="ro-row"><i class="key" style="background:var(--series-2)"></i><span class="lbl">${t('legend_repair')}</span><span class="val">${money(m.profit)}</span></div>
    <div class="ro-row ro-total"><span class="lbl">${t('total')}</span><span class="val">${money(m.rent + m.profit)}</span></div>`;
}
function chartHTML(months) {
  const top = niceCeil(Math.max(0, ...months.map((m) => Math.max(0, m.rent) + Math.max(0, m.profit))));
  if (ui.chartSel == null || ui.chartSel >= months.length) ui.chartSel = months.length - 1;
  const sel = ui.chartSel;
  const grid = top
    ? [0, 0.5, 1].map((f) => `<div class="gl${f ? '' : ' base'}" style="bottom:${f * 100}%"><span>${f ? compact(top * f) : '0'}</span></div>`).join('')
    : '<div class="gl base" style="bottom:0"></div>';
  const cols = months.map((m, i) => {
    const r = Math.max(0, m.rent), p = Math.max(0, m.profit);
    const label = `${L().months[m.m]} ${m.y} — ${t('legend_rent')}: ${moneyText(m.rent)}، ${t('legend_repair')}: ${moneyText(m.profit)}`;
    return `<button type="button" class="col" data-act="chart-col" data-i="${i}" aria-pressed="${i === sel}" aria-label="${esc(label)}">
      <span class="bar-wrap"><span class="bar">${p > 0 ? `<span class="s s2" style="height:${(p / top) * 100}%"></span>` : ''}${r > 0 ? `<span class="s s1" style="height:${(r / top) * 100}%"></span>` : ''}</span></span>
      <span class="xl">${L().months[m.m]}</span></button>`;
  }).join('');
  const rows = months.slice().reverse().map((m) => `<tr><td>${L().months[m.m]} ${m.y}</td><td>${num(m.rent)}</td><td>${num(m.profit)}</td><td><b>${num(m.rent + m.profit)}</b></td></tr>`).join('');
  return `<section class="card chart-card">
    <div class="chart-head"><h3>${t('last6')}</h3>
      <div class="legend"><span><i class="sw s1"></i>${t('legend_rent')}</span><span><i class="sw s2"></i>${t('legend_repair')}</span></div></div>
    <div class="readout" id="readout" aria-live="polite">${readoutHTML(months[sel])}</div>
    <div class="chart has-sel"><div class="plot">${grid}</div><div class="cols" style="padding-inline-end:46px">${cols}</div></div>
    <p class="hint" style="text-align:center">${t('tap_bar')}</p>
    <details class="tbl"><summary>${t('show_numbers')}${icon('chevron-down')}</summary>
      <div class="tbl-wrap"><table class="data"><thead><tr><th>${t('month_col')}</th><th>${t('legend_rent')}</th><th>${t('legend_repair')}</th><th>${t('total')}</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>
  </section>`;
}
function selectChartCol(i) {
  ui.chartSel = i;
  $('#readout').innerHTML = readoutHTML(lastMonths(6)[i]);
  $$('.chart .col').forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.i === i)));
}

function pageSettings() {
  const pinOn = !!getPin();
  const html = `
    <div class="group-title">${t('general')}</div>
    <div class="card">
      <div class="set-block"><span class="label">${t('language')}</span>
        <div class="seg">${[['ar', 'العربية'], ['ku', 'کوردی']].map(([v, l]) => `<button type="button" data-act="set-lang" data-lang="${v}" aria-pressed="${lang === v}">${l}</button>`).join('')}</div></div>
      <div class="set-block"><label class="label" for="shop-name">${t('shop_name')}</label>
        <input class="input" id="shop-name" value="${esc(db.settings.shopName)}" placeholder="${t('shop_name_ph')}" maxlength="40" enterkeyhint="done"></div>
      <div class="set-block"><span class="label">${t('theme')}</span>
        <div class="seg">${[['auto', t('th_auto')], ['light', t('th_light')], ['dark', t('th_dark')]].map(([v, l]) => `<button type="button" data-act="set-theme" data-theme="${v}" aria-pressed="${(db.settings.theme || 'auto') === v}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="group-title">${t('security')}</div>
    <div class="card"><div class="set-block set-row">
      <span class="set-ic">${icon('lock')}</span>
      <div class="mi-main"><div class="set-title">${t('pin_lock')}</div><div class="hint">${t('pin_lock_hint')}</div></div>
      <button class="btn btn-sm ${pinOn ? 'btn-ghost' : 'btn-primary'}" data-act="${pinOn ? 'pin-off' : 'pin-on'}">${pinOn ? t('pin_off_short') : t('pin_turn_on')}</button>
    </div></div>
    <div class="group-title">${t('backup')}</div>
    <div class="card">
      <div class="set-block stack">
        <div class="info-line">${icon('smartphone')}<span>${t('backup_info')}</span></div>
        <div class="info-line" id="storage-line" hidden></div>
      </div>
      <div class="set-block stack">
        <button class="btn btn-dark btn-block" data-act="backup-share">${icon('cloud')}${t('drive_btn')}</button>
        <p class="hint" style="margin-top:-4px">${t('drive_hint')}</p>
        <button class="btn btn-ghost btn-block" data-act="backup-download">${icon('download')}${t('download_btn')}</button>
        <button class="btn btn-ghost btn-block" data-act="restore">${icon('upload')}${t('restore_btn')}</button>
        <p class="hint">${db.settings.lastBackup ? t('last_backup', { d: fmtDate(ymd(new Date(db.settings.lastBackup))) }) : t('no_backup_yet')}</p>
      </div>
    </div>
    <div class="group-title">${t('danger')}</div>
    <div class="card"><div class="set-block"><button class="btn btn-danger btn-block" data-act="wipe">${icon('trash')}${t('wipe')}</button></div></div>
    ${installBlock()}
    <p class="foot-note">${t('app_name')} · ${t('version')} ${VERSION}</p>`;
  return { title: t('settings'), back: true, html, after: bindSettings };
}
function bindSettings() {
  const inp = $('#shop-name');
  inp?.addEventListener('change', () => { db.settings.shopName = inp.value.trim(); persist(); toast(t('saved')); });
  inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  const line = $('#storage-line');
  if (!line || !navigator.storage?.persisted) return;
  navigator.storage.persisted().then((ok) => {
    if (ok) { line.className = 'info-line good'; line.innerHTML = `${icon('shield')}<span>${t('storage_ok')}</span>`; line.hidden = false; }
    else if (!isStandalone()) { line.className = 'info-line warn'; line.innerHTML = `${icon('alert')}<span>${t('storage_warn')}</span>`; line.hidden = false; }
  }).catch(() => {});
}

const PAGES = { home: pageHome, rentals: pageRentals, repairs: pageRepairs, debts: pageDebts, more: pageMore, equipment: pageEquipment, customers: pageCustomers, customer: pageCustomer, reports: pageReports, activity: pageActivity, settings: pageSettings };
const LISTS = { rentals: listRentals, repairs: listRepairs, debts: listDebts, customers: listCustomers, equipment: listEquipment, activity: listActivity };

function renderNav(active) {
  const items = [['home', 'home', t('nav_home')], ['rentals', 'hammer', t('nav_rentals')], ['repairs', 'wrench', t('nav_repairs')], ['debts', 'wallet', t('nav_debts')], ['more', 'grid', t('nav_more')]];
  const nav = $('#nav');
  nav.setAttribute('aria-label', t('nav_label'));
  nav.innerHTML = `<div class="nav-inner">${items.map(([k, ic, label]) =>
    `<a href="#/${k}" data-act="tab" data-tab="${k}"${k === active ? ' aria-current="page"' : ''}><span class="pill">${icon(ic)}</span><span>${label}</span></a>`).join('')}</div>`;
}
function topbarHTML(p) {
  return `${p.back ? `<button class="icon-btn" data-act="back" aria-label="${t('back')}">${icon('arrow-right')}</button>` : ''}
    <div class="tb-title">${p.brand ? `<span class="brand-mark">${icon('wrench')}</span>` : ''}<div><h1>${esc(p.title)}</h1>${p.sub ? `<p>${esc(p.sub)}</p>` : ''}</div></div>
    ${p.actions ? `<div class="tb-actions">${p.actions}</div>` : ''}`;
}
function render(resetScroll) {
  const page = PAGES[route.name]?.(route.arg);
  if (!page) { history.replaceState({ d: 0, i: 0 }, '', '#/home'); route = parseRoute(); render(true); return; }
  document.documentElement.lang = lang === 'ku' ? 'ckb' : 'ar';
  document.title = route.name === 'home' ? (db.settings.shopName || t('app_name')) : `${page.title} · ${t('app_name')}`;
  $('#topbar').innerHTML = topbarHTML(page);
  const view = $('#view');
  view.innerHTML = page.html;
  view.classList.toggle('has-fab', !!page.fab);
  document.body.classList.toggle('with-fab', !!page.fab);
  $('#fab-slot').innerHTML = page.fab || '';
  renderNav(TABS.includes(route.name) ? route.name : PARENT[route.name]);
  if (resetScroll) window.scrollTo(0, 0);
  fitNumbers();
  page.after?.();
}
// big amounts shrink to fit their box instead of being cut off
function fitNumbers() {
  for (const el of $$('.hero-value, .stat-v, .big-stat .v, .b-value')) {
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > 11) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }
}

/* ================= sheets: rentals ================= */
const pickFace = (name, photo, avail) => `${photo ? eqThumb(photo) : `<span class="hist-ic thumb">${icon('package')}</span>`}
  <span class="ep-main"><span class="ep-name">${esc(name)}</span>${avail == null ? '' : `<span class="ep-sub">${t('available_n', { n: avail })}</span>`}</span>${icon('chevron-down', 'chev')}`;
function itemRow(it, exceptRentalId, showAvail = true) {
  // equipment deleted since this rental keeps its saved name, so editing an old rental can't lose the line
  const e = byId(db.equipment, it.equipmentId);
  const avail = e ? e.total - rentedQty(e.id, exceptRentalId) : (it.qty || 0);
  const face = it.equipmentId
    ? pickFace(e ? eqName(e) : (it.name || t('no_name')), e?.photo, showAvail ? avail : null)
    : pickFace(t('choose_equipment'), '', null);
  return `<div class="item-row" data-row data-avail="${avail}" data-name="${esc(e ? e.name : it.name || '')}">
    <input type="hidden" name="eq" value="${esc(it.equipmentId || '')}">
    <div class="ir-top"><button type="button" class="eq-pick" data-pick-eq aria-label="${t('choose_equipment')}">${face}</button>
      <button type="button" class="icon-btn" data-del-row aria-label="${t('delete')}">${icon('trash')}</button></div>
    <div class="ir-bottom">
      <div class="stepper"><button type="button" data-step="-1" aria-label="−">${icon('minus')}</button><input name="qty" inputmode="numeric" data-int value="${it.qty || 1}" aria-label="${t('qty')}"><button type="button" data-step="1" aria-label="+">${icon('plus')}</button></div>
      ${moneyInput('rate', it.rate, { label: t('rate_day') })}
    </div>
    <div class="ir-foot"><span class="ir-avail"></span><span class="ir-line"></span></div>
  </div>`;
}
// a list with pictures: a phone's native dropdown can't show them, and some products have only a picture
function equipmentPicker(exceptRentalId, onPick) {
  const rows = db.equipment.slice().sort(byName);
  const option = (e) => {
    const avail = e.total - rentedQty(e.id, exceptRentalId);
    return `<button type="button" class="eq-opt" data-id="${e.id}" data-name="${esc(e.name)}"${avail <= 0 ? ' disabled' : ''}>${eqThumb(e.photo, 'lg')}
      <span class="ep-main"><span class="ep-name">${esc(eqName(e))}</span><span class="ep-sub">${t('available_n', { n: avail })}${e.rate ? ` · ${moneyText(e.rate)} ${t('per_day')}` : ''}</span></span></button>`;
  };
  sheet({
    title: t('choose_equipment'),
    cls: 'ov-picker',
    body: `${rows.length > 6 ? `<div class="search">${icon('search')}<input class="input" type="search" placeholder="${t('search')}" aria-label="${t('search')}"></div>` : ''}
      <div class="eq-opts">${rows.map(option).join('')}</div>`,
    onMount(form) {
      const search = $('input[type=search]', form);
      search?.addEventListener('input', () => {
        const q = norm(search.value);
        $$('.eq-opt', form).forEach((b) => { b.hidden = !!q && !norm(b.textContent).includes(q); });
      });
      form.addEventListener('click', async (e) => {
        const b = e.target.closest('.eq-opt');
        if (!b || b.disabled) return;
        await closeOverlay();
        onPick(b.dataset.id);
      });
    },
  });
}

function rentalForm(id) {
  const r = id ? byId(db.rentals, id) : null;
  if (!r && !db.equipment.length) { goPage('equipment'); toast(t('need_equipment')); return; }
  const closed = r && !isOpen(r);
  const items = r ? r.items : [{ equipmentId: '', qty: 1, rate: 0 }];
  const body = `${customerField(r?.customerId)}
    <div class="field"><span class="label">${t('items_label')}</span>
      <div class="items" id="items">${items.map((it) => itemRow(it, r?.id, !closed)).join('')}</div>
      <button type="button" class="add-row" data-add-row>${icon('plus')}${t('add_item')}</button>
      <div class="err" data-err="items" hidden></div>
    </div>
    <div class="field"><label for="f-start">${t('start_date')}</label><input class="input" type="date" id="f-start" name="start" value="${r?.start || today()}"></div>
    ${closed ? `<div class="field"><label for="f-rd">${t('return_date')}</label><input class="input" type="date" id="f-rd" name="returnDate" value="${r.returnDate}"><div class="err" data-err="dates" hidden></div></div>
      <div class="field"><label for="m-total">${t('rent_total')}</label>${moneyInput('total', r.total, { id: 'm-total' })}</div>` : ''}
    <div class="field"><label for="m-adv">${t('advance')}${optLabel()}</label>${moneyInput('advance', r?.advance, { id: 'm-adv' })}</div>
    ${closed ? `<div class="field"><label for="m-par">${t('paid_at_return')}</label>${moneyInput('paidAtReturn', r.paidAtReturn, { id: 'm-par' })}</div>` : ''}
    <div class="field"><label for="f-note">${t('note')}${optLabel()}</label><textarea class="input" id="f-note" name="note" rows="2" placeholder="${t('note_ph')}">${esc(r?.note || '')}</textarea></div>
    <div class="summary"><div class="sum-row big"><span>${t('daily_total')}</span><span id="daily-sum">${money(0)}</span></div></div>`;
  sheet({
    title: r ? t('edit_rental') : t('new_rental'),
    body,
    foot: `<button type="submit" class="btn btn-primary btn-block">${icon('check')}${t('save')}</button>`,
    onMount(form) {
      bindCustomerField(form);
      const itemsEl = $('#items', form);
      const recalc = () => {
        let sum = 0;
        const rows = $$('[data-row]', itemsEl);
        for (const row of rows) {
          const chosen = !!row.querySelector('[name=eq]').value;
          const qty = Math.max(1, toInt(row.querySelector('[name=qty]').value));
          const rate = toInt(row.querySelector('[name=rate]').value);
          const avail = +row.dataset.avail;
          row.querySelector('.ir-avail').innerHTML = chosen && !closed && qty > avail ? `<span class="bad">${t('available_n', { n: avail })}</span>` : '';
          row.querySelector('.ir-line').textContent = chosen ? `${moneyText(qty * rate)} ${t('per_day')}` : '';
          if (chosen) sum += qty * rate;
        }
        $('#daily-sum', form).innerHTML = money(sum);
        rows.forEach((row) => { row.querySelector('[data-del-row]').hidden = rows.length < 2; });
      };
      const openPicker = (row) => equipmentPicker(r?.id, (eqId) => {
        const e = byId(db.equipment, eqId);
        const avail = e.total - rentedQty(eqId, r?.id);
        row.querySelector('[name=eq]').value = eqId;
        row.dataset.avail = avail;
        row.dataset.name = e.name;
        row.querySelector('.eq-pick').innerHTML = pickFace(eqName(e), e.photo, closed ? null : avail);
        row.querySelector('[name=rate]').value = e.rate ? num(e.rate) : '';
        recalc();
      });
      itemsEl.addEventListener('click', (e) => {
        const del = e.target.closest('[data-del-row]');
        if (del) { del.closest('[data-row]').remove(); recalc(); return; }
        const pick = e.target.closest('[data-pick-eq]');
        if (pick) openPicker(pick.closest('[data-row]'));
      });
      $('[data-add-row]', form).addEventListener('click', () => {
        itemsEl.insertAdjacentHTML('beforeend', itemRow({ equipmentId: '', qty: 1, rate: 0 }, r?.id));
        recalc();
        openPicker(itemsEl.lastElementChild);
      });
      form.addEventListener('input', recalc);
      onSubmit(form, () => saveRental(form, r));
      recalc();
    },
  });
}
async function saveRental(form, r) {
  clearErrs(form);
  const f = form.elements;
  const items = $$('[data-row]', form).map((row) => ({
    equipmentId: row.querySelector('[name=eq]').value,
    name: row.dataset.name || '',
    qty: Math.max(1, toInt(row.querySelector('[name=qty]').value)),
    rate: toInt(row.querySelector('[name=rate]').value),
  })).filter((x) => x.equipmentId);
  if (!items.length) return showErr(form, 'items', t('err_items'));
  if (!r || isOpen(r)) {
    const need = new Map();
    for (const x of items) need.set(x.equipmentId, (need.get(x.equipmentId) || 0) + x.qty);
    for (const [eqId, q] of need) {
      const e = byId(db.equipment, eqId);
      if (!e) continue;
      const avail = e.total - rentedQty(eqId, r?.id);
      if (q > avail) return showErr(form, 'items', t('err_qty', { name: eqName(e), n: avail }));
    }
  }
  const start = f.start.value || today();
  if (r && !isOpen(r) && (f.returnDate.value || r.returnDate) < start) return showErr(form, 'dates', t('err_dates'));
  const fields = { customerId: resolveCustomer(form), items, start, advance: toInt(f.advance.value), note: f.note.value.trim(), updatedAt: Date.now() };
  if (r) {
    const before = recSig(r);
    Object.assign(r, fields);
    if (!isOpen(r)) {
      const returnDate = f.returnDate.value || r.returnDate;
      Object.assign(r, { returnDate, days: rentDays(start, returnDate), total: toInt(f.total.value), paidAtReturn: toInt(f.paidAtReturn.value) });
    }
    if (recSig(r) !== before) {
      r.editedAt = Date.now();
      logRental('rent_edit', r);
    }
  } else {
    const rental = { id: uid(), ...fields, returnDate: null, createdAt: Date.now() };
    db.rentals.push(rental);
    logRental('rent', rental, rental.advance ? { p: rental.advance } : {});
  }
  await closeOverlay();
  commit(t('saved'));
}

function returnForm(id) {
  const r = byId(db.rentals, id);
  if (!r || !isOpen(r)) return;
  const name = custName(r.customerId);
  const daily0 = dailyOf(r), adv = r.advance || 0;
  const d0 = rentDays(r.start, today());
  // more than one piece out: choose how many come back now, the rest stays open on this rental
  const canSplit = r.items.reduce((sum, it) => sum + it.qty, 0) > 1;
  const rows = canSplit ? `<div class="field"><span class="label">${t('returned_qty')}</span>
      <div class="return-items">${r.items.map((it, i) => `<div class="return-row">
        ${itemPhoto(it) ? eqThumb(itemPhoto(it)) : ''}<div class="rr-main"><div class="rr-name">${esc(itemName(it))}</div><div class="hint">${t('out_of', { n: it.qty })} · ${moneyText(it.rate)} ${t('per_day')}</div></div>
        <div class="stepper"><button type="button" data-step="-1" aria-label="−">${icon('minus')}</button><input name="ret${i}" inputmode="numeric" data-int data-min="0" data-max="${it.qty}" value="${it.qty}" aria-label="${esc(itemName(it))}"><button type="button" data-step="1" aria-label="+">${icon('plus')}</button></div>
      </div>`).join('')}</div>
      <div class="err" data-err="ret" hidden></div>
      <div class="info-line" id="stays" hidden></div>
    </div>` : '';
  const body = `<div class="detail-head">${avatar(name)}<div class="dh-main"><div class="dh-title">${esc(name)}</div>${canSplit ? '' : `<div class="dh-sub">${itemsText(r)}</div>${miniThumbs(r)}`}</div></div>
    ${rows}
    <div class="row2">
      <div class="field"><label for="f-rd">${t('return_date')}</label><input class="input" type="date" id="f-rd" name="returnDate" value="${today()}" min="${r.start}"></div>
      <div class="field"><label for="f-days">${t('days_count')}</label><div class="stepper days-stepper"><button type="button" data-step="-1" aria-label="−">${icon('minus')}</button><input id="f-days" name="days" inputmode="numeric" data-int value="${d0}"><button type="button" data-step="1" aria-label="+">${icon('plus')}</button></div></div>
    </div>
    <div class="err" data-err="dates" hidden style="margin:-8px 0 12px"></div>
    <div class="field"><label for="m-total">${t('rent_total')}</label>${moneyInput('total', daily0 * d0, { id: 'm-total' })}
      <span class="hint" id="daily-hint"></span></div>
    <div class="summary" id="adv-box" hidden></div>
    <div class="field"><label for="m-paid">${t('pays_now')}</label>${moneyInput('paid', Math.max(0, daily0 * d0 - adv), { id: 'm-paid' })}
      <div class="quick-fill"><button type="button" data-fill="full">${t('pay_full')}</button><button type="button" data-fill="none">${t('pay_none')}</button></div></div>`;
  sheet({
    title: t('return_title'),
    body,
    foot: `<div id="result" class="foot-result"></div><button type="submit" class="btn btn-primary btn-block">${icon('check')}${t('confirm_return')}</button>`,
    onMount(form) {
      const f = form.elements;
      let totalTouched = false, paidTouched = false;
      const pieces = () => r.items.map((it, i) => (canSplit ? Math.min(it.qty, Math.max(0, toInt(f[`ret${i}`].value))) : it.qty));
      const isPartial = (q) => q.some((n, i) => n < r.items[i].qty);
      // the advance pays this part first and what is left of it stays for the rest; a full return hands back any excess
      const advanceUsed = (q, total) => (isPartial(q) ? Math.min(adv, total) : adv);
      const update = (src) => {
        if (src === 'returnDate' && f.returnDate.value) f.days.value = rentDays(r.start, f.returnDate.value);
        if (src === 'returnDate' || src === 'days' || /^ret\d/.test(src || '')) totalTouched = false;
        const q = pieces();
        const partial = isPartial(q);
        const daily = q.reduce((sum, n, i) => sum + n * r.items[i].rate, 0);
        const days = Math.max(1, toInt(f.days.value));
        if (!totalTouched) f.total.value = num(daily * days);
        const total = toInt(f.total.value);
        const used = advanceUsed(q, total);
        if (!paidTouched) f.paid.value = num(Math.max(0, total - used));
        const rem = total - used - toInt(f.paid.value);
        $('#daily-hint', form).textContent = `${moneyText(daily)} ${t('per_day')} · ${t('discount_hint')}`;
        const advBox = $('#adv-box', form);
        advBox.hidden = !adv;
        advBox.innerHTML = `<div class="sum-row"><span>${t('advance')}</span><span>${money(used)}</span></div>${
          adv > used ? `<div class="sum-row"><span>${t('advance_left')}</span><span>${money(adv - used)}</span></div>` : ''}`;
        const stays = $('#stays', form);
        if (stays) {
          stays.hidden = !partial;
          stays.innerHTML = partial ? `${icon('package')}<span><b>${t('stays_with')}:</b> ${r.items.map((it, i) => [it, it.qty - q[i]]).filter(([, n]) => n > 0).map(([it, n]) => `${esc(itemName(it))} ×${n}`).join(' · ')}</span>` : '';
        }
        $('#result', form).innerHTML = rem > 0 ? resultBox('bad', 'alert', t('to_debt'), rem)
          : rem < 0 ? resultBox('info', 'info', t('refund'), -rem) : resultBox('good', 'check', t('settled'));
      };
      form.addEventListener('input', (e) => {
        const el = e.target;
        if (el.name === 'total') totalTouched = true;
        if (el.name === 'paid') paidTouched = true;
        if (/^ret\d/.test(el.name) && el.value !== '') el.value = String(Math.min(+el.dataset.max, toInt(el.value)));
        update(el.name);
      });
      form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-fill]');
        if (!b) return;
        paidTouched = true;
        const total = toInt(f.total.value);
        f.paid.value = b.dataset.fill === 'full' ? num(Math.max(0, total - advanceUsed(pieces(), total))) : '';
        update('paid');
      });
      onSubmit(form, async () => {
        clearErrs(form);
        const q = pieces();
        if (!q.some((n) => n > 0)) return showErr(form, 'ret', t('err_return_none'));
        const returnDate = f.returnDate.value || today();
        if (returnDate < r.start) return showErr(form, 'dates', t('err_dates'));
        const total = toInt(f.total.value), paid = toInt(f.paid.value);
        const partial = isPartial(q);
        const used = advanceUsed(q, total);
        const rem = total - used - paid;
        // overpayment is handed back, so it never shows up as credit
        const now = Date.now();
        const closing = { returnDate, days: Math.max(1, toInt(f.days.value)), total, paidAtReturn: rem < 0 ? paid + rem : paid, returnedAt: now, updatedAt: now };
        if (partial) {
          // the returned part keeps the moment it was taken out
          const part = {
            id: uid(), customerId: r.customerId, start: r.start, advance: used, note: r.note, createdAt: r.createdAt || now, ...closing,
            items: r.items.map((it, i) => ({ ...it, qty: q[i] })).filter((it) => it.qty > 0),
          };
          db.rentals.push(part);
          r.items = r.items.map((it, i) => ({ ...it, qty: it.qty - q[i] })).filter((it) => it.qty > 0);
          r.advance = adv - used;
          r.updatedAt = now;
          logRental('return_part', part, { a: total, p: closing.paidAtReturn });
        } else {
          Object.assign(r, closing);
          logRental('return', r, { a: total, p: closing.paidAtReturn });
        }
        await closeOverlay();
        commit(partial ? t('returned_part_ok') : t('returned_ok'));
      });
      update();
    },
  });
}

// when a record was entered and last changed, to the second
const timeRows = (x, row, day) => `${realTime(x.createdAt) && ymd(new Date(x.createdAt)) !== day ? row(t('recorded_at'), stamp(x.createdAt)) : ''}${realTime(x.editedAt) ? row(t('edited_at'), stamp(x.editedAt)) : ''}`;
const timeHint = (x) => (realTime(x?.createdAt) ? `<p class="hint rec-hint">${icon('clock')}<span>${t('recorded_at')}: ${stamp(x.createdAt)}${realTime(x.editedAt) ? `<br>${t('edited_at')}: ${stamp(x.editedAt)}` : ''}</span></p>` : '');
function rentalDetail(id) {
  const r = byId(db.rentals, id);
  if (!r) return;
  const name = custName(r.customerId), open = isOpen(r), due = rentalDue(r);
  const row = (k, v, cls = '') => `<div><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const body = `<div class="detail-head">${avatar(name)}<div class="dh-main"><div class="dh-title">${esc(name)}</div>
      <button type="button" class="link-btn" data-go-customer="${r.customerId}">${t('customer_account')}</button></div>
      ${open ? `<span class="chip chip-brand">${t('status_open')}</span>` : `<span class="chip">${t('status_returned')}</span>`}</div>
    <div class="line-items">${r.items.map((i) => `<div class="line-item">${itemPhoto(i) ? eqThumb(itemPhoto(i)) : ''}<span class="li-name">${esc(itemName(i))}</span><span class="li-rate">${moneyText(i.rate)} ${t('per_day')}</span><span class="li-qty">×${i.qty}</span></div>`).join('')}</div>
    <div class="kv">
      ${row(t('start_date'), when(r.start, r.createdAt, true))}
      ${open ? row(t('days_count'), L().days(rentDays(r.start, today()))) : row(t('return_date'), when(r.returnDate, r.returnedAt, true)) + row(t('days_count'), L().days(r.days))}
      ${row(t('daily_total'), money(dailyOf(r)))}
      ${open ? row(t('rent_so_far'), money(accrued(r))) : row(t('rent_total'), money(r.total))}
      ${r.advance ? row(t('advance'), money(r.advance)) : ''}
      ${!open && r.paidAtReturn ? row(t('paid_at_return'), money(r.paidAtReturn)) : ''}
      ${!open ? row(due > 0 ? t('became_debt') : t('remaining'), due > 0 ? money(due) : t('settled'), due > 0 ? 'bad' : 'good') : ''}
      ${timeRows(r, row, r.start)}
    </div>
    ${r.note ? `<div class="note-box">${esc(r.note)}</div>` : ''}`;
  sheet({
    title: t('rental'),
    body,
    foot: `<button type="button" class="btn btn-danger btn-icon" data-del aria-label="${t('delete')}">${icon('trash')}</button>
      <button type="button" class="btn btn-ghost grow" data-edit>${icon('edit')}${t('edit')}</button>
      ${open ? `<button type="button" class="btn btn-primary grow" data-ret>${t('return_btn')}</button>` : ''}`,
    onMount(form) {
      form.addEventListener('click', async (e) => {
        if (e.target.closest('[data-edit]')) { await closeAll(); rentalForm(id); }
        else if (e.target.closest('[data-ret]')) { await closeAll(); returnForm(id); }
        else if (e.target.closest('[data-del]')) {
          if (!(await confirmDelete())) return;
          logRental('rent_del', r);
          db.rentals = db.rentals.filter((x) => x.id !== id);
          await closeAll();
          commit(t('deleted'));
        }
      });
    },
  });
}

/* ================= sheets: repairs ================= */
function repairForm(id) {
  const p = id ? byId(db.repairs, id) : null;
  const delivered = p?.status === 'delivered';
  const body = `${customerField(p?.customerId)}
    <div class="field"><label for="f-dev">${t('device')}${optLabel()}</label><input class="input" id="f-dev" name="device" value="${esc(p?.device || '')}" placeholder="${t('device_ph')}" maxlength="60"><div class="err" data-err="device" hidden></div></div>
    <div class="field"><label for="f-prob">${t('problem')}${optLabel()}</label><textarea class="input" id="f-prob" name="problem" rows="2" placeholder="${t('problem_ph')}">${esc(p?.problem || '')}</textarea></div>
    <div class="field"><label for="f-din">${t('date_in')}</label><input class="input" type="date" id="f-din" name="dateIn" value="${p?.dateIn || today()}"></div>
    ${delivered ? `<div class="field"><label for="f-dout">${t('date_out')}</label><input class="input" type="date" id="f-dout" name="dateOut" value="${p.dateOut}"><div class="err" data-err="dateOut" hidden></div></div>` : ''}
    <div class="field"><label for="m-price">${t('price')}${delivered ? '' : optLabel()}</label>${moneyInput('price', p?.price, { id: 'm-price' })}${delivered ? '' : `<span class="hint">${t('price_hint')}</span>`}</div>
    <div class="field"><label for="m-parts">${t('parts_cost')}${optLabel()}</label>${moneyInput('parts', p?.parts, { id: 'm-parts' })}<span class="hint">${t('parts_hint')}</span></div>
    ${delivered ? `<div class="field"><label for="m-paid">${t('paid')}</label>${moneyInput('paid', p.paid, { id: 'm-paid' })}</div>` : ''}
    <div class="summary" id="profit-sum" hidden></div>
    <div class="field"><label for="f-note">${t('note')}${optLabel()}</label><textarea class="input" id="f-note" name="note" rows="2" placeholder="${t('note_ph')}">${esc(p?.note || '')}</textarea></div>`;
  sheet({
    title: p ? t('edit_repair') : t('new_repair'),
    body,
    foot: `<button type="submit" class="btn btn-primary btn-block">${icon('check')}${t('save')}</button>`,
    onMount(form) {
      bindCustomerField(form);
      const f = form.elements;
      const recalc = () => {
        const price = toInt(f.price.value), parts = toInt(f.parts.value);
        const box = $('#profit-sum', form);
        box.hidden = !price;
        box.innerHTML = `<div class="sum-row big"><span>${t('profit')}</span><span class="${price - parts < 0 ? 'bad' : 'good'}">${money(price - parts)}</span></div>`;
      };
      form.addEventListener('input', recalc);
      onSubmit(form, async () => {
        clearErrs(form);
        if (![f.customerName.value, f.device.value, f.problem.value, f.price.value, f.note.value].some((v) => v.trim())) return showErr(form, 'device', t('err_empty'));
        const dateIn = f.dateIn.value || today();
        if (delivered && (f.dateOut.value || p.dateOut) < dateIn) return showErr(form, 'dateOut', t('err_repair_dates'));
        const fields = {
          device: f.device.value.trim(), problem: f.problem.value.trim(), dateIn,
          price: toInt(f.price.value), parts: toInt(f.parts.value), note: f.note.value.trim(), updatedAt: Date.now(),
        };
        fields.customerId = resolveCustomer(form);
        if (p) {
          const before = recSig(p);
          Object.assign(p, fields);
          if (delivered) Object.assign(p, { dateOut: f.dateOut.value || p.dateOut, paid: toInt(f.paid.value) });
          if (recSig(p) !== before) {
            p.editedAt = Date.now();
            logRepair('repair_edit', p);
          }
        } else {
          const repair = { id: uid(), ...fields, status: 'pending', paid: 0, dateOut: null, createdAt: Date.now() };
          db.repairs.push(repair);
          logRepair('repair', repair);
        }
        await closeOverlay();
        commit(t('saved'));
      });
      recalc();
    },
  });
}

function repairDetail(id) {
  const p = byId(db.repairs, id);
  if (!p) return;
  const name = custName(p.customerId), delivered = p.status === 'delivered';
  const due = repairDue(p), profit = (p.price || 0) - (p.parts || 0);
  const chip = { pending: `<span class="chip chip-info">${t('st_pending')}</span>`, ready: `<span class="chip chip-warn">${t('st_ready')}</span>`, delivered: `<span class="chip chip-good">${t('st_delivered')}</span>` }[p.status];
  const row = (k, v, cls = '') => `<div><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const body = `<div class="detail-head"><span class="hist-ic">${icon('wrench')}</span><div class="dh-main"><div class="dh-title">${esc(devName(p))}</div>
      <button type="button" class="link-btn" data-go-customer="${p.customerId}">${esc(name)}</button></div>${chip}</div>
    ${delivered ? '' : `<div class="btn-row" style="margin-bottom:14px">${p.status === 'pending' ? `<button type="button" class="btn btn-ghost" data-ready>${icon('check')}${t('mark_ready')}</button>` : ''}<button type="button" class="btn btn-primary" data-deliver>${t('deliver')}</button></div>`}
    <div class="kv">
      ${p.problem ? row(t('problem'), esc(p.problem)) : ''}
      ${row(t('date_in'), when(p.dateIn, p.createdAt, true))}
      ${realTime(p.readyAt) ? row(t('ready_at'), stamp(p.readyAt)) : ''}
      ${delivered ? row(t('date_out'), when(p.dateOut, p.deliveredAt, true)) : ''}
      ${p.price ? row(t('price'), money(p.price)) : ''}
      ${p.parts ? row(t('parts_cost'), money(p.parts)) : ''}
      ${p.price ? row(t('profit'), money(profit), profit < 0 ? 'bad' : 'good') : ''}
      ${delivered ? row(t('paid'), money(p.paid)) + row(due > 0 ? t('became_debt') : t('remaining'), due > 0 ? money(due) : t('settled'), due > 0 ? 'bad' : 'good') : ''}
      ${timeRows(p, row, p.dateIn)}
    </div>
    ${p.note ? `<div class="note-box">${esc(p.note)}</div>` : ''}`;
  sheet({
    title: t('repair'),
    body,
    foot: `<button type="button" class="btn btn-danger btn-icon" data-del aria-label="${t('delete')}">${icon('trash')}</button>
      <button type="button" class="btn btn-ghost grow" data-edit>${icon('edit')}${t('edit')}</button>`,
    onMount(form) {
      form.addEventListener('click', async (e) => {
        if (e.target.closest('[data-edit]')) { await closeAll(); repairForm(id); }
        else if (e.target.closest('[data-deliver]')) { await closeAll(); deliverForm(id); }
        else if (e.target.closest('[data-ready]')) { await closeAll(); markReady(id); }
        else if (e.target.closest('[data-del]')) {
          if (!(await confirmDelete())) return;
          logRepair('repair_del', p);
          db.repairs = db.repairs.filter((x) => x.id !== id);
          await closeAll();
          commit(t('deleted'));
        }
      });
    },
  });
}
function markReady(id) {
  const p = byId(db.repairs, id);
  if (!p) return;
  p.status = 'ready';
  p.readyAt = p.updatedAt = Date.now();
  logRepair('ready', p);
  commit(t('marked_ready'));
}

function deliverForm(id) {
  const p = byId(db.repairs, id);
  if (!p || p.status === 'delivered') return;
  const name = custName(p.customerId);
  const body = `<div class="detail-head"><span class="hist-ic">${icon('wrench')}</span><div class="dh-main"><div class="dh-title">${esc(devName(p))}</div><div class="dh-sub">${esc(name)}</div></div></div>
    <div class="field"><label for="m-price">${t('price')}${optLabel()}</label>${moneyInput('price', p.price, { id: 'm-price' })}</div>
    <div class="field"><label for="m-parts">${t('parts_cost')}${optLabel()}</label>${moneyInput('parts', p.parts, { id: 'm-parts' })}</div>
    <div class="summary"><div class="sum-row big"><span>${t('profit')}</span><span id="profit">${money(0)}</span></div></div>
    <div class="field"><label for="f-dout">${t('date_out')}</label><input class="input" type="date" id="f-dout" name="dateOut" value="${today()}" min="${p.dateIn}"><div class="err" data-err="dateOut" hidden></div></div>
    <div class="field"><label for="m-paid">${t('pays_now')}</label>${moneyInput('paid', p.price, { id: 'm-paid' })}
      <div class="quick-fill"><button type="button" data-fill="full">${t('pay_full')}</button><button type="button" data-fill="none">${t('pay_none')}</button></div></div>`;
  sheet({
    title: t('deliver_title'),
    body,
    foot: `<div id="result" class="foot-result"></div><button type="submit" class="btn btn-primary btn-block">${icon('check')}${t('confirm_deliver')}</button>`,
    onMount(form) {
      const f = form.elements;
      let paidTouched = false;
      const update = () => {
        const price = toInt(f.price.value), parts = toInt(f.parts.value);
        if (!paidTouched) f.paid.value = price ? num(price) : '';
        const profit = price - parts;
        $('#profit', form).innerHTML = `<span class="${profit < 0 ? 'bad' : 'good'}">${money(profit)}</span>`;
        const rem = price - toInt(f.paid.value);
        $('#result', form).innerHTML = rem > 0 ? resultBox('bad', 'alert', t('to_debt'), rem)
          : rem < 0 ? resultBox('info', 'info', t('refund'), -rem) : resultBox('good', 'check', t('settled'));
      };
      form.addEventListener('input', (e) => { if (e.target.name === 'paid') paidTouched = true; update(); });
      form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-fill]');
        if (!b) return;
        paidTouched = true;
        f.paid.value = b.dataset.fill === 'full' ? num(toInt(f.price.value)) : '';
        update();
      });
      onSubmit(form, async () => {
        clearErrs(form);
        const dateOut = f.dateOut.value || today();
        if (dateOut < p.dateIn) return showErr(form, 'dateOut', t('err_repair_dates'));
        const price = toInt(f.price.value);
        Object.assign(p, {
          status: 'delivered', price, parts: toInt(f.parts.value), paid: Math.min(price, toInt(f.paid.value)),
          dateOut, deliveredAt: Date.now(), updatedAt: Date.now(),
        });
        logRepair('deliver', p, { a: p.price, p: p.paid });
        await closeOverlay();
        commit(t('delivered_ok'));
      });
      update();
    },
  });
}

/* ================= sheets: payments & debts ================= */
function ledgerForm(type, { cid, id } = {}) {
  const entry = id ? byId(db.ledger, id) : null;
  if (entry) { type = entry.type; cid = entry.customerId; }
  const pay = type === 'pay';
  const title = entry ? (pay ? t('edit_payment') : t('edit_debt')) : (pay ? t('record_payment') : t('add_debt'));
  const body = `${timeHint(entry)}${customerField(cid)}
    <div class="summary" id="cur-debt" hidden></div>
    <div class="field"><label for="m-amount">${t('amount')}</label>${moneyInput('amount', entry?.amount, { id: 'm-amount' })}
      ${pay ? `<div class="quick-fill" id="fill-all" hidden><button type="button" data-fill-all>${t('pay_all_debt')}</button></div>` : ''}
      <div class="err" data-err="amount" hidden></div></div>
    <div class="field"><label for="f-date">${t('date')}</label><input class="input" type="date" id="f-date" name="date" value="${entry?.date || today()}"></div>
    <div class="field"><label for="f-note">${t('note')}${optLabel()}</label><textarea class="input" id="f-note" name="note" rows="2" placeholder="${pay ? t('note_ph') : t('debt_reason_ph')}">${esc(entry?.note || '')}</textarea></div>`;
  sheet({
    title,
    body,
    foot: `<div id="result" class="foot-result"></div>${entry ? `<button type="button" class="btn btn-danger btn-icon" data-del aria-label="${t('delete')}">${icon('trash')}</button>` : ''}
      <button type="submit" class="btn btn-primary grow">${icon('check')}${t('save')}</button>`,
    onMount(form) {
      const f = form.elements;
      let current = null;
      const updateResult = () => {
        const box = $('#result', form);
        if (!pay || current == null || !toInt(f.amount.value)) { box.innerHTML = ''; return; }
        const after = current - toInt(f.amount.value);
        box.innerHTML = after > 0 ? resultBox('bad', 'info', t('after_payment'), after)
          : after < 0 ? resultBox('info', 'info', t('credit'), -after) : resultBox('good', 'check', t('settled'));
      };
      const onCustomer = (cidNow) => {
        const box = $('#cur-debt', form);
        if (!cidNow) { current = null; box.hidden = true; $('#fill-all', form)?.setAttribute('hidden', ''); updateResult(); return; }
        let b = balances().get(cidNow) || 0;
        if (entry && entry.customerId === cidNow) b -= entry.type === 'debt' ? entry.amount : -entry.amount;
        current = b;
        box.hidden = false;
        box.innerHTML = `<div class="sum-row"><span>${t('current_debt')}</span><span class="${b > 0 ? 'bad' : 'good'}">${b > 0 ? money(b) : t('no_balance')}</span></div>`;
        const fill = $('#fill-all', form);
        if (fill) fill.hidden = !(b > 0);
        updateResult();
      };
      bindCustomerField(form, onCustomer, pay);
      form.addEventListener('input', (e) => { if (e.target.name === 'amount') updateResult(); });
      form.addEventListener('click', async (e) => {
        if (e.target.closest('[data-fill-all]') && current > 0) { f.amount.value = num(current); updateResult(); }
        if (e.target.closest('[data-del]')) {
          if (!(await confirmDelete())) return;
          logLedger('ledger_del', entry);
          db.ledger = db.ledger.filter((x) => x.id !== entry.id);
          await closeAll();
          commit(t('deleted'));
        }
      });
      onSubmit(form, async () => {
        clearErrs(form);
        const amount = toInt(f.amount.value);
        if (amount <= 0) return showErr(form, 'amount', t('err_amount'));
        const fields = { customerId: resolveCustomer(form), amount, date: f.date.value || today(), note: f.note.value.trim(), updatedAt: Date.now() };
        if (entry) {
          const before = recSig(entry);
          Object.assign(entry, fields);
          if (recSig(entry) !== before) {
            entry.editedAt = Date.now();
            logLedger('ledger_edit', entry);
          }
        } else {
          const line = { id: uid(), type, ...fields, createdAt: Date.now() };
          db.ledger.push(line);
          logLedger(pay ? 'pay' : 'debt', line);
        }
        await closeOverlay();
        commit(pay ? t('payment_saved') : t('debt_saved'));
      });
    },
  });
}

/* ================= sheets: customers & equipment ================= */
function customerForm(id) {
  const c = id ? byId(db.customers, id) : null;
  const body = `${timeHint(c)}<div class="field"><label for="f-name">${t('name')}${optLabel()}</label><input class="input" id="f-name" name="name" value="${esc(c?.name || '')}" maxlength="60" autocomplete="off"><div class="err" data-err="name" hidden></div></div>
    <div class="field"><label for="f-phone">${t('phone')}${optLabel()}</label><input class="input ltr-input" id="f-phone" name="phone" type="tel" inputmode="tel" value="${esc(c?.phone || '')}" placeholder="07xx xxx xxxx" maxlength="20"></div>
    <div class="field"><label for="f-note">${t('note')}${optLabel()}</label><textarea class="input" id="f-note" name="note" rows="2" placeholder="${t('note_ph')}">${esc(c?.note || '')}</textarea></div>`;
  sheet({
    title: c ? t('edit_customer') : t('new_customer'),
    body,
    foot: `${c ? `<button type="button" class="btn btn-danger btn-icon" data-del aria-label="${t('delete')}">${icon('trash')}</button>` : ''}
      <button type="submit" class="btn btn-primary grow">${icon('check')}${t('save')}</button>`,
    onMount(form) {
      const f = form.elements;
      form.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-del]')) return;
        if (hasRecords(c.id)) { await confirmBox({ title: t('delete'), message: t('customer_has_records'), ok: t('close') }); return; }
        if (!(await confirmDelete())) return;
        logAction('cust_del', logCust(c.id));
        db.customers = db.customers.filter((x) => x.id !== c.id);
        await closeAll();
        persist();
        if (route.name === 'customer') goBack(); else render();
        toast(t('deleted'));
      });
      onSubmit(form, async () => {
        clearErrs(form);
        const phone = latinDigits(f.phone.value).trim();
        const name = f.name.value.trim() || phone;
        if (!name) return showErr(form, 'name', t('err_empty'));
        if (db.customers.some((x) => x.id !== c?.id && norm(x.name) === norm(name))) return showErr(form, 'name', t('customer_exists'));
        const fields = { name, phone, note: f.note.value.trim(), updatedAt: Date.now() };
        if (c) {
          const before = recSig(c);
          Object.assign(c, fields);
          if (recSig(c) !== before) {
            c.editedAt = Date.now();
            logAction('cust_edit', { r: c.id, ...logCust(c.id) });
          }
        } else {
          const person = { id: uid(), ...fields, createdAt: Date.now() };
          db.customers.push(person);
          logAction('cust_new', { r: person.id, ...logCust(person.id) });
        }
        await closeOverlay();
        commit(t('saved'));
      });
    },
  });
}

function equipmentForm(id) {
  const e = id ? byId(db.equipment, id) : null;
  const out = e ? rentedQty(e.id) : 0;
  const body = `${timeHint(e)}<div class="field"><span class="label">${t('photo')}${optLabel()}</span>
      <input type="hidden" name="photo"><input type="file" id="photo-file" accept="image/*" hidden>
      <div id="photo-box"></div><div class="err" data-err="photo" hidden></div></div>
    <div class="field"><label for="f-name">${t('equipment_name')}${optLabel()}</label><input class="input" id="f-name" name="name" value="${esc(e?.name || '')}" placeholder="${t('equipment_name_ph')}" maxlength="60" autocomplete="off"><div class="err" data-err="name" hidden></div></div>
    <div class="row2">
      <div class="field"><label for="f-total">${t('total_qty')}</label><div class="stepper"><button type="button" data-step="-1" aria-label="−">${icon('minus')}</button><input id="f-total" name="total" inputmode="numeric" data-int value="${e?.total || 1}"><button type="button" data-step="1" aria-label="+">${icon('plus')}</button></div></div>
      <div class="field"><label for="m-rate">${t('daily_rate')}${optLabel()}</label>${moneyInput('rate', e?.rate, { id: 'm-rate' })}</div>
    </div>
    <div class="err" data-err="total" hidden style="margin:-8px 0 12px"></div>
    ${out ? `<div class="summary"><div class="sum-row"><span>${t('rented_out', { n: out })}</span></div></div>` : ''}
    <div class="field"><label for="f-note">${t('note')}${optLabel()}</label><textarea class="input" id="f-note" name="note" rows="2" placeholder="${t('note_ph')}">${esc(e?.note || '')}</textarea></div>`;
  sheet({
    title: e ? t('edit_equipment') : t('new_equipment'),
    body,
    foot: `${e ? `<button type="button" class="btn btn-danger btn-icon" data-del aria-label="${t('delete')}">${icon('trash')}</button>` : ''}
      <button type="submit" class="btn btn-primary grow">${icon('check')}${t('save')}</button>`,
    onMount(form) {
      const f = form.elements;
      const box = $('#photo-box', form), file = $('#photo-file', form);
      const drawPhoto = () => {
        box.innerHTML = f.photo.value
          ? `<div class="photo-set"><img class="photo-preview" src="${esc(f.photo.value)}" alt="">
              <div class="photo-actions"><button type="button" class="btn btn-sm btn-ghost" data-photo-pick>${icon('camera')}${t('photo_change')}</button>
              <button type="button" class="btn btn-sm btn-danger" data-photo-del>${icon('trash')}${t('photo_remove')}</button></div></div>`
          : `<button type="button" class="photo-add" data-photo-pick>${icon('camera')}<span>${t('photo_add')}</span></button>`;
      };
      let photoJob = Promise.resolve();
      file.addEventListener('change', () => {
        const picked = file.files[0];
        if (!picked) return;
        $('[data-err="photo"]', form).hidden = true;
        photoJob = photoToDataUrl(picked)
          .then((data) => { f.photo.value = data; drawPhoto(); })
          .catch(() => showErr(form, 'photo', t('photo_bad')));
        file.value = '';
      });
      form.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-photo-pick]')) { file.click(); return; } // inside the tap: phones only open the picker from one
        if (ev.target.closest('[data-photo-del]')) { f.photo.value = ''; drawPhoto(); return; }
        if (!ev.target.closest('[data-del]')) return;
        if (out) { await confirmBox({ title: t('delete'), message: t('equipment_in_use'), ok: t('close') }); return; }
        if (!(await confirmDelete())) return;
        logAction('eq_del', { x: e.name });
        db.equipment = db.equipment.filter((x) => x.id !== e.id);
        await closeAll();
        commit(t('deleted'));
      });
      onSubmit(form, async () => {
        await photoJob;
        clearErrs(form);
        const name = f.name.value.trim();
        if (!name && !f.photo.value) return showErr(form, 'name', t('err_eq_empty'));
        const total = Math.max(1, toInt(f.total.value));
        if (total < out) return showErr(form, 'total', t('err_total_lt_rented', { n: out }));
        const fields = { name, total, rate: toInt(f.rate.value), photo: f.photo.value, note: f.note.value.trim(), updatedAt: Date.now() };
        if (e) {
          const before = recSig(e);
          Object.assign(e, fields);
          if (recSig(e) !== before) {
            e.editedAt = Date.now();
            logAction('eq_edit', { r: e.id, x: e.name });
          }
        } else {
          const item = { id: uid(), ...fields, createdAt: Date.now() };
          db.equipment.push(item);
          logAction('eq_new', { r: item.id, x: item.name });
        }
        await closeOverlay();
        commit(t('saved'));
      });
      f.photo.value = e?.photo || '';
      drawPhoto();
    },
  });
}

/* ================= backup & restore ================= */
const BACKUP_APP = 'daftar-mahal';
const backupText = () => JSON.stringify({ app: BACKUP_APP, format: 1, version: VERSION, exportedAt: new Date().toISOString(), data: db });
const backupName = () => `hareem-backup-${today()}.txt`;
function markBackup() {
  db.settings.lastBackup = new Date().toISOString();
  logAction('backup');
  persist();
  render();
  toast(t('backup_ready'));
}
// The share sheet is how Google Drive is reached: on Android/iOS it lists "Drive" (Save to Drive).
// .txt because Chrome's Web Share refuses .json files.
async function backupShare() {
  const file = new File([backupText()], backupName(), { type: 'text/plain' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: backupName() });
      markBackup();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  backupDownload();
}
function backupDownload() {
  const url = URL.createObjectURL(new Blob([backupText()], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: backupName() });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  markBackup();
}
let afterRestore = null;
function pickRestore(after) {
  afterRestore = after || null;
  const inp = $('#restore-input');
  inp.value = '';
  inp.click();
}
async function onRestoreFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  let parsed = null;
  try { parsed = JSON.parse(await file.text()); } catch (err) { /* not JSON */ }
  if (!parsed || parsed.app !== BACKUP_APP || !parsed.data || !Array.isArray(parsed.data.rentals)) { toast(t('restore_bad')); return; }
  if (hasData()) {
    const when = parsed.exportedAt ? fmtDate(ymd(new Date(parsed.exportedAt)), true) : '';
    const ok = await confirmBox({ title: t('restore_confirm_title'), message: t('restore_confirm', { d: when }), ok: t('restore_btn'), danger: true });
    if (!ok) return;
  }
  const keep = { lang, theme: db.settings.theme };
  db = normalizeDb(parsed.data);
  Object.assign(db.settings, keep);
  logAction('restore');
  await writeDb();
  askPersist();
  applyTheme();
  toast(t('restore_done'));
  const cb = afterRestore;
  afterRestore = null;
  if (cb) cb(); else render(true);
}

async function wipeAll() {
  if (!(await confirmBox({ title: t('wipe'), message: t('wipe_msg'), ok: t('wipe'), danger: true }))) return;
  if (!(await confirmBox({ title: t('wipe'), message: t('wipe_msg2'), ok: t('yes_delete'), danger: true }))) return;
  const keep = { lang, theme: db.settings.theme };
  db = fresh();
  Object.assign(db.settings, keep);
  logAction('wipe');
  setPin(null);
  await writeDb();
  goTab('home');
  toast(t('wiped'));
}

/* ================= PIN lock ================= */
// The PIN lives outside the data (not in backups); it guards the screen, the data itself stays on the phone.
const PIN_KEY = 'daftar-mahal.pin';
function getPin() { try { return JSON.parse(localStorage.getItem(PIN_KEY) || 'null'); } catch (err) { return null; } }
function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, JSON.stringify(v)); else localStorage.removeItem(PIN_KEY); } catch (err) { /* ignore */ } }
async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261; // FNV-1a fallback when not served over https
  for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}
const keypadHTML = () => `<div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-key="${n}">${n}</button>`).join('')}
  <span></span><button type="button" data-key="0">0</button><button type="button" class="kp-del" data-key="del" aria-label="⌫">${icon('backspace')}</button></div>`;
const dotsHTML = () => '<div class="pin-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';
function pinPad(root, onComplete) {
  let val = '';
  let busy = false;
  const dots = $$('.pin-dots i', root);
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < val.length));
  const reset = () => { val = ''; busy = false; paint(); };
  const press = (k) => {
    if (busy) return;
    if (k === 'del') val = val.slice(0, -1);
    else if (val.length < 4) val += k;
    paint();
    if (val.length === 4) { busy = true; setTimeout(() => onComplete(val, reset), 140); }
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-key]'); if (b) press(b.dataset.key); });
  return { press };
}
function shake(root) {
  const d = $('.pin-dots', root);
  d.classList.remove('shake');
  d.getBoundingClientRect();
  d.classList.add('shake');
  try { navigator.vibrate?.(120); } catch (err) { /* ignore */ }
}
function showLock(onUnlock) {
  locked = true;
  const host = $('#screen');
  host.innerHTML = `<div class="screen lock" role="dialog" aria-modal="true"><div class="screen-inner">
      <div class="welcome-logo">${icon('wrench')}</div>
      <h1>${esc(db.settings.shopName || t('app_name'))}</h1>
      <p class="lock-sub" id="lock-sub">${t('pin_enter')}</p>
      ${dotsHTML()}${keypadHTML()}
      <button type="button" class="link-btn" id="pin-forgot" style="margin-top:26px">${t('pin_forgot')}</button>
    </div></div>`;
  const root = $('.lock', host);
  const onKey = (e) => {
    if (/^\d$/.test(e.key)) pad.press(e.key);
    else if (e.key === 'Backspace') pad.press('del');
  };
  const unlock = () => {
    host.innerHTML = '';
    locked = false;
    document.removeEventListener('keydown', onKey);
    onUnlock?.();
  };
  const pad = pinPad(root, async (val, reset) => {
    const p = getPin();
    if (!p || (await hashPin(val, p.salt)) === p.hash) { unlock(); return; }
    const sub = $('#lock-sub', root);
    sub.textContent = t('pin_wrong');
    sub.classList.add('bad');
    shake(root);
    reset();
  });
  document.addEventListener('keydown', onKey);
  $('#pin-forgot', root).addEventListener('click', () => {
    confirmBox({
      title: t('pin_forgot'),
      message: t('pin_forgot_msg'),
      ok: t('restore_btn'),
      onYes: () => pickRestore(() => { setPin(null); unlock(); if ($('#app').hidden) startApp(); else render(true); }),
    });
  });
}
function pinSetupSheet() {
  sheet({
    title: t('pin_lock'),
    body: `<div class="pin-wrap"><p class="lock-sub" id="ps-sub">${t('pin_new')}</p>${dotsHTML()}${keypadHTML()}</div>`,
    onMount(form) {
      let first = null;
      pinPad(form, async (val, reset) => {
        const sub = $('#ps-sub', form);
        if (!first) { first = val; sub.textContent = t('pin_repeat'); sub.classList.remove('bad'); reset(); return; }
        if (val !== first) { first = null; sub.textContent = t('pin_mismatch'); sub.classList.add('bad'); shake(form); reset(); return; }
        const salt = uid();
        setPin({ salt, hash: await hashPin(val, salt) });
        await closeOverlay();
        render();
        toast(t('pin_enabled'));
      });
    },
  });
}
function pinDisableSheet() {
  sheet({
    title: t('pin_turn_off'),
    body: `<div class="pin-wrap"><p class="lock-sub" id="ps-sub">${t('pin_enter')}</p>${dotsHTML()}${keypadHTML()}</div>`,
    onMount(form) {
      pinPad(form, async (val, reset) => {
        const p = getPin();
        if (p && (await hashPin(val, p.salt)) !== p.hash) {
          const sub = $('#ps-sub', form);
          sub.textContent = t('pin_wrong');
          sub.classList.add('bad');
          shake(form);
          reset();
          return;
        }
        setPin(null);
        await closeOverlay();
        render();
        toast(t('pin_disabled'));
      });
    },
  });
}

/* ================= welcome (first run) ================= */
function showWelcome() {
  const host = $('#screen');
  const begin = () => {
    db.settings.lang = lang;
    writeDb();
    host.innerHTML = '';
    startApp();
  };
  const draw = () => {
    document.documentElement.lang = lang === 'ku' ? 'ckb' : 'ar';
    host.innerHTML = `<div class="screen welcome"><div class="screen-inner">
        <div class="welcome-logo">${icon('wrench')}</div>
        <h1>${t('welcome_title')}</h1>
        <p class="lead">${t('welcome_sub')}</p>
        <form id="welcome-form" autocomplete="off" novalidate>
          <div class="field"><span class="label">${t('choose_lang')}</span>
            <div class="lang-pick">
              <button type="button" data-wl="ar" aria-pressed="${lang === 'ar'}">${lang === 'ar' ? icon('check') : ''}العربية</button>
              <button type="button" data-wl="ku" aria-pressed="${lang === 'ku'}">${lang === 'ku' ? icon('check') : ''}کوردی</button>
            </div></div>
          <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px">${t('start')}${icon('arrow-left')}</button>
        </form>
        <div class="spacer"></div>
        <button type="button" class="btn btn-ghost btn-block" id="w-restore">${icon('upload')}${t('have_backup')}</button>
      </div></div>`;
    const form = $('#welcome-form', host);
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-wl]');
      if (!b) return;
      lang = b.dataset.wl;
      draw();
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); begin(); });
    $('#w-restore', host).addEventListener('click', () => pickRestore(begin));
  };
  draw();
}

/* ================= install & offline ================= */
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installBlock() {
  if (isStandalone()) return '';
  if (installEvt) {
    return `<div class="card menu menu-card" style="margin-top:12px"><button class="menu-item" data-act="install">
      <span class="mi-ic brand">${icon('smartphone')}</span><span class="mi-main"><span class="mi-title">${t('install')}</span><span class="mi-hint">${t('install_hint')}</span></span>${icon('chevron-left', 'chev')}</button></div>`;
  }
  if (isIOS()) return `<div class="card" style="margin-top:12px;padding:14px 16px"><div class="info-line">${icon('smartphone')}<span><b>${t('install')}</b><br>${t('install_ios')}</span></div></div>`;
  return '';
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  if (!$('#app').hidden && (route.name === 'more' || route.name === 'settings')) render();
});
window.addEventListener('appinstalled', () => { installEvt = null; persistAsked = false; askPersist(); if (!$('#app').hidden) render(); });
async function doInstall() {
  if (!installEvt) return;
  installEvt.prompt();
  try { await installEvt.userChoice; } catch (err) { /* ignore */ }
  installEvt = null;
  render();
}
function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  // during local development keep files fresh unless ?sw is in the URL
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !location.search.includes('sw')) return;
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('service worker', err));
}

function applyTheme() {
  const th = db.settings.theme || 'auto';
  if (th === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = th;
  const colors = { light: '#F4F2EE', dark: '#0E0C0B' };
  $$('meta[name="theme-color"]').forEach((m) => {
    const scheme = (m.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
    m.setAttribute('content', th === 'auto' ? colors[scheme] : colors[th]);
  });
}
function setLang(l) {
  lang = l;
  db.settings.lang = l;
  persist();
  render();
}

/* ================= global events ================= */
const ACTIONS = {
  tab: (el) => goTab(el.dataset.tab),
  page: (el) => goPage(el.dataset.page, el.dataset.arg),
  back: () => goBack(),
  log: (el) => {
    const id = el.dataset.id;
    ({ rental: () => rentalDetail(id), repair: () => repairDetail(id), ledger: () => ledgerForm(null, { id }), equipment: () => equipmentForm(id), customer: () => goPage('customer', id) })[el.dataset.target]?.();
  },
  seg: (el) => { ui.seg[el.dataset.key] = el.dataset.val; render(); },
  more: (el) => { ui.limit[el.dataset.key] = (ui.limit[el.dataset.key] || LIST_STEP) + LIST_STEP; render(); },
  'toggle-lang': () => setLang(lang === 'ar' ? 'ku' : 'ar'),
  'set-lang': (el) => setLang(el.dataset.lang),
  'set-theme': (el) => { db.settings.theme = el.dataset.theme; applyTheme(); commit(); },
  'new-rental': () => rentalForm(),
  'new-repair': () => repairForm(),
  'new-payment': (el) => ledgerForm('pay', { cid: el.dataset.cid }),
  'new-debt': (el) => ledgerForm('debt', { cid: el.dataset.cid }),
  'new-customer': () => customerForm(),
  'new-equipment': () => equipmentForm(),
  rental: (el) => rentalDetail(el.dataset.id),
  return: (el) => returnForm(el.dataset.id),
  repair: (el) => repairDetail(el.dataset.id),
  ready: (el) => markReady(el.dataset.id),
  deliver: (el) => deliverForm(el.dataset.id),
  customer: (el) => goPage('customer', el.dataset.id),
  'edit-customer': (el) => customerForm(el.dataset.id),
  equipment: (el) => equipmentForm(el.dataset.id),
  ledger: (el) => ledgerForm(null, { id: el.dataset.id }),
  'chart-col': (el) => selectChartCol(+el.dataset.i),
  'pin-on': () => pinSetupSheet(),
  'pin-off': () => pinDisableSheet(),
  'backup-share': () => backupShare(),
  // iPhones can't save a generated file from an installed app; the share sheet can
  'backup-download': () => (isIOS() ? backupShare() : backupDownload()),
  restore: () => pickRestore(),
  wipe: () => wipeAll(),
  install: () => doInstall(),
};
document.addEventListener('click', (e) => {
  const step = e.target.closest('[data-step]');
  if (step) {
    const inp = step.parentElement.querySelector('input');
    const min = inp.dataset.min === undefined ? 1 : +inp.dataset.min;
    const max = inp.dataset.max === undefined ? Infinity : +inp.dataset.max;
    inp.value = Math.min(max, Math.max(min, toInt(inp.value) + Number(step.dataset.step)));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || !ACTIONS[el.dataset.act]) return;
  e.preventDefault();
  ACTIONS[el.dataset.act](el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('[data-money]')) {
    const raw = latinDigits(el.value).replace(/\D/g, '').slice(0, 12);
    el.value = raw ? num(+raw) : '';
  } else if (el.matches('[data-int]')) {
    el.value = latinDigits(el.value).replace(/\D/g, '').slice(0, 5);
  } else if (el.matches('[data-search]')) {
    ui.q[el.dataset.search] = el.value;
    const list = $('#list');
    if (list && LISTS[el.dataset.search]) list.innerHTML = LISTS[el.dataset.search]();
  }
});
// keep the focused field visible above the on-screen keyboard
document.addEventListener('focusin', (e) => {
  if (e.target.closest('.sheet-body') && e.target.matches('input, textarea, select')) {
    setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  }
});
window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
$('#restore-input').addEventListener('change', onRestoreFile);

// The on-screen keyboard: hide the bottom bar so typing has room, and on iPhone (where the
// page keeps its full height under the keyboard) fit sheets to the part still visible.
let tallest = 0, lastWidth = 0;
function trackViewport() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; tallest = 0; }
  tallest = Math.max(tallest, h);
  const typing = document.activeElement?.matches('input, textarea');
  document.body.classList.toggle('keyboard-open', navigator.maxTouchPoints > 0 && !!typing && tallest - h > 140);
  const root = document.documentElement.style;
  if (vv && window.innerHeight - vv.height > 100) {
    root.setProperty('--vv-top', `${vv.offsetTop}px`);
    root.setProperty('--vv-h', `${vv.height}px`);
  } else {
    root.removeProperty('--vv-top');
    root.removeProperty('--vv-h');
  }
}
window.addEventListener('resize', () => { trackViewport(); if (!$('#app').hidden) fitNumbers(); });
window.visualViewport?.addEventListener('resize', trackViewport);
window.visualViewport?.addEventListener('scroll', trackViewport);
document.addEventListener('focusout', () => setTimeout(trackViewport, 50));
trackViewport();

if (channel) channel.onmessage = () => syncFromStore();
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    return;
  }
  syncFromStore();
  if (hiddenAt && Date.now() - hiddenAt > 60000 && getPin() && !locked && db.settings.lang) showLock();
});

/* ================= boot ================= */
function startApp() {
  $('#app').hidden = false;
  $('#nav').hidden = false;
  if (!history.state) history.replaceState({ d: 0, i: 0 }, '', location.hash || '#/home');
  route = parseRoute();
  render(true);
  askPersist();
  document.fonts?.ready.then(() => { if (!$('#app').hidden) fitNumbers(); });
}
async function boot() {
  registerSW();
  db = await loadDb();
  lang = db.settings.lang || (/^(ckb|ku)/i.test(navigator.language || '') ? 'ku' : 'ar');
  applyTheme();
  document.documentElement.lang = lang === 'ku' ? 'ckb' : 'ar';
  if (!db.settings.lang) { showWelcome(); return; }
  if (getPin()) { showLock(startApp); return; }
  startApp();
}
boot();
