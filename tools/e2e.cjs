'use strict';
// End-to-end tests for the هريم app, driven on emulated phones with real taps.
// Usage: npm i playwright  &&  node tools/e2e.cjs [name-filter]
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const pw = require(process.env.PW_HOME ? path.join(process.env.PW_HOME, 'playwright') : 'playwright');
const { chromium, webkit, firefox, devices } = pw;

const APP_DIR = path.resolve(__dirname, '../daftar');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'hareem-shots');
const NOW = '2026-11-07T10:00:00+03:00';
const APP_VERSION = fs.readFileSync(path.join(APP_DIR, 'sw.js'), 'utf8').match(/VERSION = '([^']+)'/)[1];
const SHEET = '.ov-sheet:not(.closing)';
const DIALOG = '.ov-dialog:not(.closing)';
const filter = process.argv[2] || '';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hareem-tls-'));
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=hareem.test'], { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}
function serve(dir, { prefix = '/', cache = 'no-store', tls = null } = {}) {
  const handler = (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith(prefix)) { res.writeHead(404); res.end('not found'); return; }
    p = `/${p.slice(prefix.length)}`;
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': cache });
      res.end(d);
    });
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  return new Promise((resolve) => server.listen(0, () => resolve({
    url: `http://localhost:${server.address().port}/`,
    close: () => { server.closeAllConnections(); server.close(); },
  })));
}

/* ---------- tiny assertion kit ---------- */
const results = [];
let assertions = 0;
const J = (x) => JSON.stringify(x);
function eq(actual, expected, label) {
  assertions++;
  if (J(actual) !== J(expected)) throw new Error(`${label}\n     expected ${J(expected)}\n     got      ${J(actual)}`);
}
function ok(cond, label) {
  assertions++;
  if (!cond) throw new Error(label);
}
function has(text, sub, label) {
  assertions++;
  if (!String(text).includes(sub)) throw new Error(`${label}: ${J(sub)} not in ${J(text)}`);
}
function hasNot(text, sub, label) {
  assertions++;
  if (String(text).includes(sub)) throw new Error(`${label}: ${J(sub)} should not be in ${J(text)}`);
}

/* ---------- phone helper ---------- */
const browsers = {};
async function getBrowser(engine) {
  if (!browsers[engine]) browsers[engine] = await { chromium, webkit, firefox }[engine].launch();
  return browsers[engine];
}
let BASE = '';
class App {
  constructor(page, ctx, base) {
    this.p = page; this.ctx = ctx; this.base = base;
    this.problems = [];
    this.watch(page);
  }
  watch(page) {
    page.on('pageerror', (e) => this.problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('interactive-widget')) this.problems.push(`console: ${m.text()}`); });
    page.on('dialog', (d) => { this.problems.push(`native dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(this.base) && !u.startsWith('data:') && !u.startsWith('blob:')) this.problems.push(`external request: ${u}`);
    });
  }
  async open(q = '') { await this.p.goto(this.base + q); }
  async start(lang = 'ar', q = '') {
    await this.open(q);
    await this.p.waitForSelector('#welcome-form');
    if (lang !== 'ar') await this.p.tap(`[data-wl="${lang}"]`);
    await this.p.tap('#welcome-form [type=submit]');
    await this.p.waitForSelector('.nav a');
  }
  tab(n) { return this.p.tap(`.nav a[data-tab="${n}"]`); }
  async page(n) { await this.tab('more'); await this.p.tap(`[data-page="${n}"]`); }
  async fab() { await this.p.tap('.fab'); await this.sheetOpen(); }
  async sheetOpen() { await this.p.waitForSelector(`${SHEET} .sheet-head`); await this.p.waitForTimeout(340); }
  async dialogOpen() { await this.p.waitForSelector(`${DIALOG} [data-yes]`); await this.p.waitForTimeout(240); }
  set(name, v) { return this.p.fill(`${SHEET} [name="${name}"]`, String(v)); }
  val(name) { return this.p.inputValue(`${SHEET} [name="${name}"]`); }
  submit() { return this.p.tap(`${SHEET} [type=submit]`); }
  async closed() { await this.p.waitForFunction(() => !document.querySelector('.ov:not(.closing)'), null, { timeout: 4000 }); await this.p.waitForTimeout(40); }
  async save() { await this.submit(); await this.closed(); }
  async err(key) {
    const el = `${SHEET} [data-err="${key}"]`;
    await this.p.waitForSelector(`${el}:not([hidden])`, { timeout: 2500 });
    return (await this.p.textContent(el)).trim();
  }
  text(sel) { return this.p.$eval(sel, (e) => e.innerText.replace(/\u200E/g, '').replace(/\s+/g, ' ').trim()); }
  texts(sel) { return this.p.$$eval(sel, (es) => es.map((e) => e.innerText.replace(/\u200E/g, '').replace(/\s+/g, ' ').trim())); }
  js(fn, arg) { return this.p.evaluate(fn, arg); }
  T(lang = 'ar') { return this.p.evaluate((l) => { const o = {}; for (const [k, v] of Object.entries(window.I18N[l])) if (typeof v === 'string') o[k] = v; return o; }, lang); }
  async toast() { await this.p.waitForSelector('#toast.show', { timeout: 3000 }); return (await this.p.textContent('#toast')).trim(); }
  async clearToast() { await this.p.evaluate(() => document.querySelector('#toast').classList.remove('show')); }
  async newCustomer(name, phone) {
    await this.set('customerName', name);
    await this.p.tap(`${SHEET} .combo-add`);
    if (phone) await this.set('customerPhone', phone);
  }
  async pickCustomer(typed, expectName) {
    await this.set('customerName', typed);
    await this.p.tap(`${SHEET} .combo-opt[data-cid]`);
    if (expectName) eq(await this.val('customerName'), expectName, 'customer picked');
  }
  async pickEquipment(i, name, qty, rate) {
    const row = `${SHEET} [data-row]:nth-child(${i + 1})`;
    if (!(await this.p.$('.ov-picker:not(.closing)'))) await this.p.tap(`${row} [data-pick-eq]`); // "add" opens the list by itself
    await this.p.waitForSelector('.ov-picker:not(.closing) .eq-opt');
    await this.p.waitForTimeout(340);
    await this.p.tap(`.ov-picker:not(.closing) .eq-opt[data-name="${name}"]`);
    await this.p.waitForFunction(() => !document.querySelector('.ov-picker:not(.closing)'));
    await this.p.waitForTimeout(40);
    if (qty != null) await this.p.fill(`${row} [name=qty]`, String(qty));
    if (rate != null) await this.p.fill(`${row} [name=rate]`, String(rate));
  }
  async choosePhoto(file) {
    const [fc] = await Promise.all([this.p.waitForEvent('filechooser'), this.p.tap(`${SHEET} [data-photo-pick]`)]);
    await fc.setFiles(file);
  }
  async addEquipment(name, total, rate) {
    await this.fab();
    await this.set('name', name); await this.set('total', total); await this.set('rate', rate);
    await this.save();
  }
  async done() {
    const problems = this.problems.slice();
    await this.ctx.close();
    eq(problems, [], 'no errors, native dialogs or outside requests');
  }
}
// E2E_ENGINE=webkit runs the default phone on the iPhone engine
async function phone({ engine = process.env.E2E_ENGINE || 'chromium', device = engine === 'webkit' ? 'iPhone 14' : 'Pixel 7', viewport, now = NOW, colorScheme = 'light', base = BASE, ...rest } = {}) {
  const browser = await getBrowser(engine);
  const d = { ...devices[device] };
  const ctx = await browser.newContext({ ...d, ...(viewport ? { viewport } : {}), locale: 'ar-IQ', timezoneId: 'Asia/Baghdad', colorScheme, acceptDownloads: true, ...rest });
  if (now) await ctx.clock.setFixedTime(new Date(now));
  const page = await ctx.newPage();
  return new App(page, ctx, base);
}
async function test(name, fn) {
  if (filter && !name.includes(filter)) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push(['PASS', name, Date.now() - t0]);
    console.log(`  PASS  ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
    console.log(`  FAIL  ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`);
  }
}

// Data whose totals were worked out by hand (see the reports test).
function seedKnown() {
  db.equipment = [
    { id: 'e1', name: 'خلاطة', total: 5, rate: 25000 },
    { id: 'e2', name: 'سقالة', total: 50, rate: 1500 },
  ];
  db.customers = [{ id: 'c1', name: 'أحمد', phone: '07701112222', note: '' }, { id: 'c2', name: 'كاك ئازاد', phone: '', note: '' }];
  const R = (id, c, items, start, ret, days, total, advance, paid) => db.rentals.push({ id, customerId: c, items: items.map(([e, q]) => ({ equipmentId: e, name: e === 'e1' ? 'خلاطة' : 'سقالة', qty: q, rate: e === 'e1' ? 25000 : 1500 })), start, advance, note: '', returnDate: ret, days, total, paidAtReturn: paid, createdAt: 1, updatedAt: 1 });
  R('r1', 'c1', [['e1', 1]], '2026-11-01', '2026-11-05', 4, 100000, 20000, 50000);
  R('r2', 'c2', [['e2', 10]], '2026-10-20', '2026-11-02', 13, 195000, 50000, 145000);
  R('r3', 'c1', [['e1', 2], ['e2', 10]], '2026-10-01', '2026-10-03', 2, 130000, 0, 130000);
  R('r4', 'c2', [['e1', 1]], '2026-11-06', null, null, null, 10000, null);
  R('r5', 'c1', [['e1', 1]], '2026-01-10', '2026-01-12', 2, 50000, 0, 50000);
  R('r6', 'c1', [['e2', 1]], '2025-12-01', '2025-12-05', 4, 6000, 0, 6000);
  const P = (id, c, device, dIn, dOut, price, parts, paid, status) => db.repairs.push({ id, customerId: c, device, problem: '', dateIn: dIn, dateOut: dOut, price, parts, paid, status, note: '', createdAt: 1, updatedAt: 1 });
  P('p1', 'c1', 'دريل', '2026-11-01', '2026-11-03', 45000, 15000, 30000, 'delivered');
  P('p2', 'c2', 'مولدة', '2026-10-10', '2026-10-15', 80000, 90000, 80000, 'delivered');
  P('p3', 'c2', 'هزاز', '2026-11-05', null, 0, 0, 0, 'pending');
  P('p4', 'c1', 'جلاخة', '2025-12-18', '2025-12-20', 10000, 0, 10000, 'delivered');
  db.ledger = [
    { id: 'l1', customerId: 'c1', type: 'pay', amount: 5000, date: '2026-11-04', note: '', createdAt: 1 },
    { id: 'l2', customerId: 'c2', type: 'debt', amount: 70000, date: '2026-05-15', note: 'حساب قديم', createdAt: 1 },
  ];
  commit();
}

/* ======================================================================== */
async function suite() {
  await test('branding: first run says هريم everywhere', async () => {
    const a = await phone();
    await a.open();
    await a.p.waitForSelector('#welcome-form');
    has(await a.text('.welcome h1'), 'هريم', 'welcome title');
    eq(await a.p.$$eval('#welcome-form input', (x) => x.length), 0, 'welcome asks only the language');
    await a.p.tap('[data-wl="ku"]');
    eq(await a.text('.welcome h1'), 'بەخێربێیت بۆ هریم', 'kurdish welcome');
    eq(await a.js(() => document.documentElement.lang), 'ckb', 'kurdish lang attr');
    await a.p.tap('[data-wl="ar"]');
    await a.p.tap('#welcome-form [type=submit]');
    await a.p.waitForSelector('.nav a');
    eq(await a.text('.tb-title h1'), 'هريم', 'home title');
    eq(await a.p.title(), 'هريم', 'document title');
    eq(await a.text('.tb-title p'), 'السبت، 7 تشرين الثاني', 'home date');
    has(await a.text('#view'), (await a.T()).need_equipment, 'first-run guidance on home');
    const man = await a.js(async () => {
      const m = await (await fetch('manifest.webmanifest')).json();
      const icons = [];
      for (const i of m.icons) { const r = await fetch(i.src); const b = await createImageBitmap(await r.blob()); icons.push([i.sizes, r.status, b.width, b.height, i.purpose]); }
      return { name: m.name, short: m.short_name, display: m.display, start: m.start_url, scope: m.scope, icons };
    });
    eq([man.name, man.short, man.display, man.start, man.scope], ['هريم', 'هريم', 'standalone', './#/home', './'], 'manifest fields');
    eq(man.icons.map((i) => [i[0], i[1], `${i[2]}x${i[3]}`]), [['192x192', 200, '192x192'], ['512x512', 200, '512x512'], ['192x192', 200, '192x192'], ['512x512', 200, '512x512']], 'manifest icons are real images of the declared size');
    eq(await a.js(() => db.settings.shopName), 'هريم', 'shop name stored');
    await a.done();
  });

  await test('equipment: add, validate, edit, delete', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.page('equipment');
    has(await a.text('#list'), T.no_equipment, 'empty state');
    await a.fab();
    await a.submit();
    eq(await a.err('name'), T.err_eq_empty, 'needs at least a name or a picture');
    await a.set('name', 'خلاطة كونكريت');
    await a.p.tap(`${SHEET} [name=rate]`);
    await a.p.keyboard.type('٢٥٠٠٠'); // Arabic-Indic digits from a phone keyboard
    eq(await a.val('rate'), '25,000', 'Arabic digits converted and grouped');
    await a.p.tap(`${SHEET} [data-step="1"]`);
    await a.p.tap(`${SHEET} [data-step="1"]`);
    eq(await a.val('total'), '3', 'stepper up');
    await a.p.tap(`${SHEET} [data-step="-1"]`);
    await a.p.tap(`${SHEET} [data-step="-1"]`);
    await a.p.tap(`${SHEET} [data-step="-1"]`);
    eq(await a.val('total'), '1', 'stepper never below 1');
    await a.set('total', '۳'); // Persian/Kurdish digit
    eq(await a.val('total'), '3', 'Kurdish digit converted');
    await a.save();
    eq(await a.toast(), T.saved, 'saved toast');
    eq(await a.text('#list .rc'), `خلاطة كونكريت متوفر 3 من 3 25,000 ${T.currency} ${T.per_day}`, 'card');
    await a.addEquipment('مؤقت', 1, 1000);
    eq(await a.js(() => db.equipment.length), 2, 'two items');
    // edit
    await a.p.tap('#list .rc:nth-child(1) .rc-hit');
    await a.sheetOpen();
    eq(await a.val('name'), 'خلاطة كونكريت', 'edit loads the sorted first item');
    await a.set('rate', 30000);
    await a.save();
    eq(await a.js(() => db.equipment.find((e) => e.name === 'خلاطة كونكريت').rate), 30000, 'edit saved');
    // delete: cancel, then confirm
    await a.p.tap('#list .rc:nth-child(2) .rc-hit');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-del]`);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} .dialog-actions [data-no]`);
    await a.p.waitForTimeout(350);
    eq(await a.js(() => db.equipment.length), 2, 'cancel keeps it');
    await a.p.tap(`${SHEET} [data-del]`);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.closed();
    eq(await a.js(() => db.equipment.map((e) => e.name)), ['خلاطة كونكريت'], 'deleted');
    await a.done();
  });

  await test('rental: validation, calculation, availability', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.page('equipment');
    await a.addEquipment('خلاطة', 3, 25000);
    await a.addEquipment('سقالة', 40, 1500);
    await a.addEquipment('مولدة', 1, 35000);
    await a.tab('rentals');
    await a.fab();
    await a.newCustomer('أحمد الجبوري', '٠٧٧٠ ١٢٣ ٤٥٦٧');
    await a.submit();
    eq(await a.err('items'), T.err_items, 'equipment required');
    await a.pickEquipment(0, 'سقالة', 41);
    eq(await a.val('rate'), '1,500', 'rate filled from the equipment');
    has(await a.text(`${SHEET} .ir-avail`), '40', 'over-quantity warning');
    await a.submit();
    eq(await a.err('items'), T.err_qty.replace('{name}', 'سقالة').replace('{n}', '40'), 'over quantity blocked');
    await a.p.fill(`${SHEET} [data-row]:nth-child(1) [name=qty]`, '20');
    await a.p.tap(`${SHEET} [data-add-row]`);
    await a.pickEquipment(1, 'سقالة', 21);
    await a.submit();
    eq(await a.err('items'), T.err_qty.replace('{name}', 'سقالة').replace('{n}', '40'), 'two lines of one item are added together');
    await a.pickEquipment(1, 'خلاطة', 1);
    eq(await a.text('#daily-sum'), `55,000 ${T.currency}`, 'daily total');
    await a.set('start', '2026-11-02');
    await a.set('advance', '20000');
    await a.set('note', 'موقع الكرادة');
    await a.save();
    const c = await a.js(() => db.customers[0]);
    eq([c.name, c.phone], ['أحمد الجبوري', '0770 123 4567'], 'customer created with latin phone digits');
    const card = await a.text('#list .rc');
    has(card, 'سقالة ×20 · خلاطة ×1', 'items on the card');
    has(card, '2 تشرين الثاني', 'start date');
    has(card, 'منذ 5 أيام', 'elapsed days');
    has(card, `275,000 ${T.currency}`, '5 × 55,000');
    // availability
    await a.page('equipment');
    const eqCards = await a.texts('#list .rc');
    has(eqCards.find((x) => x.startsWith('سقالة')), 'متوفر 20 من 40', 'scaffolds out');
    has(eqCards.find((x) => x.startsWith('خلاطة')), 'متوفر 2 من 3', 'mixer out');
    // equipment in use can't be deleted or reduced below what's out
    await a.p.tap('#list .rc:nth-child(2) .rc-hit');
    await a.sheetOpen();
    await a.set('total', 19);
    await a.submit();
    eq(await a.err('total'), T.err_total_lt_rented.replace('{n}', '20'), 'cannot reduce below rented');
    await a.p.tap(`${SHEET} [data-del]`);
    await a.dialogOpen();
    has(await a.text(DIALOG), T.equipment_in_use, 'cannot delete rented equipment');
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.p.waitForTimeout(400);
    await a.js(() => closeAll());
    await a.closed();
    // options show what is left; a fully rented item is disabled
    await a.tab('rentals');
    await a.fab();
    await a.newCustomer('علي');
    await a.pickEquipment(0, 'مولدة');
    await a.save();
    await a.fab();
    await a.p.tap(`${SHEET} [data-pick-eq]`);
    await a.p.waitForSelector('.ov-picker:not(.closing) .eq-opt');
    const opts = await a.p.$$eval('.ov-picker:not(.closing) .eq-opt', (os) => os.map((o) => [o.dataset.name, o.querySelector('.ep-sub').innerText.split('·')[0].trim(), o.disabled]));
    eq(opts, [['خلاطة', 'المتوفر: 2', false], ['سقالة', 'المتوفر: 20', false], ['مولدة', 'المتوفر: 0', true]], 'options');
    await a.js(() => closeAll());
    await a.closed();
    // editing an open rental doesn't count its own quantity against itself
    await a.p.tap('#list .rc:nth-child(1) .rc-hit');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-edit]`);
    await a.sheetOpen();
    await a.p.fill(`${SHEET} [data-row]:nth-child(1) [name=qty]`, '40');
    await a.save();
    eq(await a.js(() => db.rentals[0].items[0].qty), 40, 'own quantity excluded');
    has(await a.text('#list .rc:nth-child(1)'), `${(40 * 1500 + 25000) * 5 > 0 ? '425,000' : ''}`, 'amount updated after edit');
    await a.done();
  });

  await test('return: dates, days, discount, payment, refund', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.js(() => {
      db.equipment = [{ id: 'e1', name: 'خلاطة', total: 3, rate: 25000 }, { id: 'e2', name: 'سقالة', total: 40, rate: 1500 }];
      db.customers = [{ id: 'c1', name: 'أحمد', phone: '', note: '' }];
      db.rentals = [
        { id: 'r1', customerId: 'c1', items: [{ equipmentId: 'e2', name: 'سقالة', qty: 20, rate: 1500 }, { equipmentId: 'e1', name: 'خلاطة', qty: 1, rate: 25000 }], start: '2026-11-02', advance: 20000, note: '', returnDate: null },
        { id: 'r2', customerId: 'c1', items: [{ equipmentId: 'e1', name: 'خلاطة', qty: 1, rate: 25000 }], start: '2026-11-06', advance: 100000, note: '', returnDate: null },
      ];
      commit();
    });
    await a.tab('rentals');
    await a.p.tap('#list .rc:nth-child(1) [data-act="return"]');
    await a.sheetOpen();
    eq([await a.val('days'), await a.val('total'), await a.val('paid')], ['5', '275,000', '255,000'], 'defaults');
    eq(await a.text(`${SHEET} #result`), T.settled, 'settled by default');
    await a.set('paid', 155000);
    eq(await a.text(`${SHEET} #result`), `${T.to_debt} 100,000 ${T.currency}`, 'partial payment');
    await a.p.tap(`${SHEET} [data-fill="none"]`);
    eq([await a.val('paid'), await a.text(`${SHEET} #result`)], ['', `${T.to_debt} 255,000 ${T.currency}`], 'pay nothing');
    await a.p.tap(`${SHEET} [data-fill="full"]`);
    eq(await a.val('paid'), '255,000', 'pay all');
    // date drives days and the total
    await a.set('returnDate', '2026-11-12');
    eq([await a.val('days'), await a.val('total')], ['10', '550,000'], 'later return date');
    await a.p.tap(`${SHEET} .days-stepper [data-step="-1"]`);
    eq([await a.val('days'), await a.val('total')], ['9', '495,000'], 'days stepper');
    await a.set('total', 250000);
    eq(await a.val('days'), '9', 'discount leaves the days');
    eq(await a.val('total'), '250,000', 'discount kept');
    await a.set('returnDate', '2026-11-01');
    await a.submit();
    eq(await a.err('dates'), T.err_dates, 'return before start blocked');
    await a.set('returnDate', '2026-11-07');
    eq([await a.val('days'), await a.val('total')], ['5', '275,000'], 'back to today');
    await a.set('paid', 155000);
    await a.save();
    eq(await a.toast(), T.returned_ok, 'toast');
    const r = await a.js(() => { const x = db.rentals[0]; return [x.returnDate, x.days, x.total, x.paidAtReturn, rentalDue(x), balances().get('c1')]; });
    eq(r, ['2026-11-07', 5, 275000, 155000, 100000, 100000], 'stored rental');
    await a.page('equipment');
    has((await a.texts('#list .rc')).find((x) => x.startsWith('سقالة')), 'متوفر 40 من 40', 'stock restored');
    // advance bigger than the rent: the difference goes back, no credit, no debt
    await a.tab('rentals');
    await a.p.tap('#list .rc:nth-child(1) [data-act="return"]');
    await a.sheetOpen();
    eq([await a.val('days'), await a.val('total'), await a.val('paid')], ['1', '25,000', '0'], 'one day');
    eq(await a.text(`${SHEET} #result`), `${T.refund} 75,000 ${T.currency}`, 'refund shown');
    await a.save();
    const r2 = await a.js(() => { const x = db.rentals[1]; return [x.paidAtReturn, rentalDue(x), balances().get('c1')]; });
    eq(r2, [-75000, 0, 100000], 'refund stored, debt unchanged');
    // closed list
    await a.p.tap('[data-act="seg"][data-val="closed"]');
    const cards = await a.texts('#list .rc');
    eq(cards.length, 2, 'two closed');
    ok(cards.some((c) => c.includes(`${T.debt} 100,000 ${T.currency}`)), 'debt chip on the closed rental');
    ok(cards.some((c) => c.includes(T.settled)), 'settled chip on the other');
    // detail shows the whole story
    await a.p.tap('#list .rc:has-text("سقالة") .rc-hit');
    await a.sheetOpen();
    const d = await a.text(`${SHEET} .sheet-body`);
    for (const piece of ['السبت، 7 تشرين الثاني 2026', '5 أيام', `275,000 ${T.currency}`, `20,000 ${T.currency}`, `155,000 ${T.currency}`, T.became_debt, `100,000 ${T.currency}`, '×20']) has(d, piece, 'rental detail');
    await a.done();
  });

  await test('partial return: split, advance, debt, stock, reports all add up', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    const c = (n) => `${n} ${T.currency}`;
    await a.js(() => {
      db.equipment = [{ id: 'e1', name: 'خلاطة', total: 3, rate: 25000 }, { id: 'e2', name: 'سقالة', total: 40, rate: 1500 }];
      db.customers = [{ id: 'c1', name: 'أحمد', phone: '', note: '' }];
      db.rentals = [
        { id: 'r1', customerId: 'c1', items: [{ equipmentId: 'e2', name: 'سقالة', qty: 20, rate: 1500 }, { equipmentId: 'e1', name: 'خلاطة', qty: 1, rate: 25000 }], start: '2026-11-02', advance: 20000, note: 'موقع', returnDate: null },
        { id: 'r2', customerId: 'c1', items: [{ equipmentId: 'e2', name: 'سقالة', qty: 10, rate: 1500 }], start: '2026-11-06', advance: 100000, note: '', returnDate: null },
        { id: 'r3', customerId: 'c1', items: [{ equipmentId: 'e1', name: 'خلاطة', qty: 1, rate: 25000 }], start: '2026-11-06', advance: 0, note: '', returnDate: null },
      ];
      commit();
    });
    const openReturn = async (id) => { await a.js((x) => returnForm(x), id); await a.sheetOpen(); };
    // one single piece: nothing to choose
    await openReturn('r3');
    eq(await a.p.$$eval(`${SHEET} .return-row`, (x) => x.length), 0, 'no quantity choice for a single piece');
    has(await a.text(`${SHEET} .dh-sub`), 'خلاطة ×1', 'single item named in the header');
    await a.js(() => closeAll());
    await a.closed();
    // starts as a full return, so the usual case stays one tap
    await openReturn('r1');
    eq(await a.p.$$eval(`${SHEET} .return-row`, (x) => x.length), 2, 'one row per item');
    eq([await a.val('ret0'), await a.val('ret1'), await a.val('days'), await a.val('total'), await a.val('paid')], ['20', '1', '5', '275,000', '255,000'], 'defaults to everything');
    eq(await a.p.isVisible(`${SHEET} #stays`), false, 'nothing stays yet');
    // part of it comes back
    await a.set('ret0', 8);
    await a.set('ret1', 0);
    eq([await a.val('total'), await a.val('paid')], ['60,000', '40,000'], '8 x 1,500 x 5, minus the advance');
    has(await a.text(`${SHEET} #daily-hint`), c('12,000'), 'daily price of this part');
    const stays = await a.text(`${SHEET} #stays`);
    has(stays, T.stays_with, 'label'); has(stays, 'سقالة ×12', 'scaffolds staying'); has(stays, 'خلاطة ×1', 'mixer staying');
    eq(await a.text(`${SHEET} #result`), T.settled, 'covered by advance and payment');
    await a.set('paid', 30000);
    eq(await a.text(`${SHEET} #result`), `${T.to_debt} ${c('10,000')}`, 'rest becomes debt');
    // limits
    await a.set('ret0', 99);
    eq([await a.val('ret0'), await a.val('total')], ['20', '150,000'], 'typing more than he has is capped');
    await a.p.tap(`${SHEET} .return-row:nth-child(2) [data-step="1"]`);
    await a.p.tap(`${SHEET} .return-row:nth-child(2) [data-step="1"]`);
    eq(await a.val('ret1'), '1', 'stepper stops at what he has');
    await a.p.tap(`${SHEET} .return-row:nth-child(2) [data-step="-1"]`);
    await a.p.tap(`${SHEET} .return-row:nth-child(2) [data-step="-1"]`);
    eq(await a.val('ret1'), '0', 'stepper stops at zero');
    await a.set('ret0', '٨'); // Arabic digit
    eq(await a.val('ret0'), '8', 'digits from any keyboard');
    await a.set('ret0', 0);
    await a.submit();
    eq(await a.err('ret'), T.err_return_none, 'must return something');
    await a.set('ret0', '');
    await a.submit();
    eq(await a.err('ret'), T.err_return_none, 'empty counts as nothing');
    eq(await a.js(() => db.rentals.length), 3, 'nothing saved yet');
    await a.set('ret0', 8);
    // changing the date still recalculates this part only
    await a.set('returnDate', '2026-11-12');
    eq([await a.val('days'), await a.val('total')], ['10', '120,000'], 'date applies to the part');
    await a.set('returnDate', '2026-11-07');
    await a.save();
    eq(await a.toast(), T.returned_part_ok, 'toast says part');
    const after = await a.js(() => {
      const open = db.rentals.find((r) => r.id === 'r1');
      const part = db.rentals.find((r) => !['r1', 'r2', 'r3'].includes(r.id));
      return {
        open: [open.items.map((i) => [i.equipmentId, i.qty, i.rate]), open.advance, open.returnDate, open.start, accrued(open)],
        part: [part.items.map((i) => [i.equipmentId, i.name, i.qty, i.rate]), part.advance, part.total, part.paidAtReturn, part.days, part.returnDate, part.start, part.customerId, part.note, rentalDue(part)],
        bal: balances().get('c1'),
        out: [rentedQty('e1'), rentedQty('e2')],
      };
    });
    eq(after.open, [[['e2', 12, 1500], ['e1', 1, 25000]], 0, null, '2026-11-02', 215000], 'the rest stays open from the same date');
    eq(after.part, [[['e2', 'سقالة', 8, 1500]], 20000, 60000, 30000, 5, '2026-11-07', '2026-11-02', 'c1', 'موقع', 10000], 'returned part closed');
    eq(after.bal, 10000, 'only the unpaid part is debt');
    eq(after.out, [2, 22], 'stock: mixers r1+r3, scaffolds 12+10');
    // screens agree
    await a.tab('rentals');
    const openCards = await a.texts('#list .rc');
    ok(openCards.some((x) => x.includes('سقالة ×12 · خلاطة ×1') && x.includes(c('215,000'))), 'open card shows what is left');
    await a.p.tap('[data-act="seg"][data-val="closed"]');
    const closedCard = await a.text('#list .rc');
    for (const piece of ['سقالة ×8', c('60,000'), `${T.debt} ${c('10,000')}`]) has(closedCard, piece, 'closed card');
    await a.page('equipment');
    has((await a.texts('#list .rc')).find((x) => x.startsWith('سقالة')), 'متوفر 18 من 40', 'scaffolds back in stock');
    // advance bigger than the part: it stays for the rest, nothing is refunded yet
    await openReturn('r2');
    await a.set('ret0', 2);
    eq([await a.val('days'), await a.val('total'), await a.val('paid')], ['1', '3,000', '0'], 'covered by the advance');
    const adv = await a.text(`${SHEET} #adv-box`);
    has(adv, c('3,000'), 'advance used'); has(adv, T.advance_left, 'label'); has(adv, c('97,000'), 'advance left');
    eq(await a.text(`${SHEET} #result`), T.settled, 'settled');
    await a.save();
    eq(await a.js(() => { const o = db.rentals.find((r) => r.id === 'r2'); return [o.items[0].qty, o.advance, balances().get('c1')]; }), [8, 97000, 10000], 'advance carried over, debt unchanged');
    // returning the rest: now the excess really goes back
    await openReturn('r2');
    eq([await a.val('ret0'), await a.val('total'), await a.val('paid')], ['8', '12,000', '0'], 'rest of it');
    eq(await a.text(`${SHEET} #result`), `${T.refund} ${c('85,000')}`, 'refund of the excess');
    await a.save();
    eq(await a.toast(), T.returned_ok, 'full return toast');
    eq(await a.js(() => { const o = db.rentals.find((x) => x.id === 'r2'); return [o.returnDate, o.paidAtReturn, rentalDue(o), balances().get('c1')]; }), ['2026-11-07', -85000, 0, 10000], 'closed with a refund');
    // finish r1 with one more partial, then the last piece
    await openReturn('r1');
    await a.set('ret0', 12);
    await a.set('ret1', 0);
    eq(await a.val('total'), '90,000', '12 x 1,500 x 5');
    await a.save();
    eq(await a.js(() => db.rentals.find((r) => r.id === 'r1').items.map((i) => [i.equipmentId, i.qty])), [['e1', 1]], 'finished item removed from the open rental');
    await openReturn('r1');
    eq(await a.p.$$eval(`${SHEET} .return-row`, (x) => x.length), 0, 'one piece left: no choice needed');
    eq(await a.val('total'), '125,000', '1 x 25,000 x 5');
    await a.save();
    // the books balance: rent earned = cash received + debt still owed
    const books = await a.js(() => {
      const s = stats(null);
      return { rent: s.rent, cash: s.cash, debt: balances().get('c1'), open: db.rentals.filter(isOpen).map((r) => r.id), out: [rentedQty('e1'), rentedQty('e2')], n: s.rentN };
    });
    eq(books.open, ['r3'], 'only the untouched rental is still open');
    eq(books.out, [1, 0], 'stock all back but r3');
    eq(books.n, 5, 'five closed records');
    eq(books.rent, 60000 + 3000 + 12000 + 90000 + 125000, 'rent earned');
    eq(books.cash + books.debt, books.rent, 'cash + debt = rent earned');
    // unsaved quantity is protected, and everything survives a restart
    await openReturn('r3');
    await a.js(() => closeAll());
    await a.closed();
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => [db.rentals.length, balances().get('c1')]), [6, books.debt], 'kept after restart');
    await a.done();
  });

  await test('partial return: asks before dropping a changed quantity, Kurdish text', async () => {
    const a = await phone();
    await a.start('ku');
    const T = await a.T('ku');
    await a.js(() => {
      db.equipment = [{ id: 'e2', name: 'سقالة', total: 40, rate: 1500 }];
      db.customers = [{ id: 'c1', name: 'کاک ئازاد', phone: '', note: '' }];
      db.rentals = [{ id: 'r1', customerId: 'c1', items: [{ equipmentId: 'e2', name: 'سقالة', qty: 20, rate: 1500 }], start: '2026-11-02', advance: 0, note: '', returnDate: null }];
      commit();
      goTab('rentals');
    });
    await a.p.tap('#list [data-act="return"]');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.closed(); // unchanged form closes silently
    await a.p.tap('#list [data-act="return"]');
    await a.sheetOpen();
    has(await a.text(`${SHEET} .return-row`), T.out_of.replace('{n}', '20'), 'row in Kurdish');
    await a.set('ret0', 5);
    has(await a.text(`${SHEET} #stays`), `${T.stays_with}: سقالة ×15`, 'stays in Kurdish');
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} .dialog-actions [data-no]`);
    await a.p.waitForTimeout(350);
    eq(await a.val('ret0'), '5', 'kept');
    // double tap on confirm: one split only
    await a.js(() => { const s = document.querySelector('.ov-sheet:not(.closing) [type=submit]'); s.click(); s.click(); setTimeout(() => s.click(), 60); });
    await a.closed();
    await a.p.waitForTimeout(150);
    eq(await a.js(() => [db.rentals.length, db.rentals[0].items[0].qty, db.rentals[1].items[0].qty]), [2, 15, 5], 'split happened once');
    eq(await a.toast(), T.returned_part_ok, 'Kurdish toast');
    await a.done();
  });

  await test('photos: camera or gallery, sideways pictures, sizes, remove, change, protect', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hareem-photos-'));
    // a big phone photo marked "rotated" in its EXIF data, the way phone cameras save portrait shots
    const b64 = await a.js(() => {
      const c = document.createElement('canvas');
      c.width = 3000; c.height = 2000;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 3000, 2000);
      grad.addColorStop(0, '#d94'); grad.addColorStop(1, '#25a');
      g.fillStyle = grad; g.fillRect(0, 0, 3000, 2000);
      for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7},70%,${30 + (i % 40)}%)`; g.fillRect((i * 37) % 3000, (i * 91) % 2000, 60, 60); }
      return c.toDataURL('image/jpeg', 0.92).split(',')[1];
    });
    const jpeg = Buffer.from(b64, 'base64');
    const exif = Buffer.concat([Buffer.from([0xFF, 0xE1, 0x00, 0x22]), Buffer.from('Exif\0\0', 'latin1'), Buffer.from([0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])]);
    const rotated = path.join(dir, 'camera.jpg');
    fs.writeFileSync(rotated, Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]));
    const plain = path.join(dir, 'plain.jpg');
    fs.writeFileSync(plain, jpeg);
    const notImage = path.join(dir, 'note.jpg');
    fs.writeFileSync(notImage, 'this is not a picture');
    const picture = () => a.js(() => { const i = document.querySelector('.ov-sheet:not(.closing) .photo-preview'); return i && i.complete ? [i.naturalWidth, i.naturalHeight] : null; });

    await a.page('equipment');
    await a.fab();
    ok(await a.p.isVisible(`${SHEET} .photo-add`), 'add-picture button shown, nothing required');
    // a file that isn't a picture
    await a.choosePhoto(notImage);
    eq(await a.err('photo'), T.photo_bad, 'bad file explained');
    eq(await a.val('photo'), '', 'no picture kept');
    // a real one: shrunk, stored small, and turned the right way up
    await a.choosePhoto(rotated);
    await a.p.waitForSelector(`${SHEET} .photo-preview`);
    await a.p.waitForFunction(() => document.querySelector('.ov-sheet:not(.closing) .photo-preview').complete);
    eq(await a.p.isVisible(`${SHEET} [data-err="photo"]`), false, 'error cleared');
    eq(await picture(), [320, 480], '3000x2000 camera shot marked rotated becomes upright, longest side 480');
    const size = (await a.val('photo')).length;
    ok(size < 120 * 1024, `stored small: ${size} bytes`);
    console.log(`        stored picture: ${Math.round(size / 1024)} KB from a ${Math.round(fs.statSync(rotated).size / 1024)} KB file`);
    // unsaved picture is protected
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} .dialog-actions [data-no]`);
    await a.p.waitForTimeout(350);
    // picture only, no name, no price, default quantity
    await a.save();
    const e = await a.js(() => db.equipment[0]);
    eq([e.name, e.total, e.rate, e.photo.startsWith('data:image/jpeg')], ['', 1, 0, true], 'saved with the picture alone');
    const card = await a.text('#list .rc');
    has(card, T.no_name, 'card falls back to "no name"');
    eq(await a.js(() => { const i = document.querySelector('#list .rc img.thumb'); return i.complete && i.naturalWidth > 0; }), true, 'picture shows on the card');
    // change, then remove, then put back, on the saved item
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    await a.p.waitForFunction(() => document.querySelector('.ov-sheet:not(.closing) .photo-preview')?.complete);
    await a.choosePhoto(plain);
    await a.p.waitForFunction(() => { const i = document.querySelector('.ov-sheet:not(.closing) .photo-preview'); return i && i.complete && i.naturalWidth === 480; });
    eq(await picture(), [480, 320], 'second picture keeps its own shape');
    await a.p.tap(`${SHEET} [data-photo-del]`);
    eq(await a.p.isVisible(`${SHEET} .photo-add`), true, 'back to the add button');
    await a.submit();
    eq(await a.err('name'), T.err_eq_empty, 'no name and no picture left');
    await a.set('name', 'خلاطة كبيرة');
    await a.save();
    eq(await a.js(() => [db.equipment[0].name, db.equipment[0].photo]), ['خلاطة كبيرة', ''], 'picture removed');
    has(await a.text('#list .rc'), 'خلاطة كبيرة', 'name shown');
    eq(await a.p.$$eval('#list .rc img', (x) => x.length), 0, 'no picture on the card');
    // if the fast decoder is missing the app still manages (older phones), under the strict security policy
    await a.js(() => { window.createImageBitmap = () => Promise.reject(new Error('unsupported')); });
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    await a.choosePhoto(plain);
    await a.p.waitForFunction(() => { const i = document.querySelector('.ov-sheet:not(.closing) .photo-preview'); return i && i.complete && i.naturalWidth === 480; });
    await a.save();
    eq(await a.js(() => db.equipment[0].photo.length > 1000), true, 'fallback decoder worked');
    // survives a restart
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => db.equipment[0].photo.startsWith('data:image/jpeg')), true, 'picture kept after restart');
    fs.rmSync(dir, { recursive: true, force: true });
    await a.done();
  });

  await test('photos: choosing by picture, rentals, return, reports, backup, restore', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    const c = (n) => `${n} ${T.currency}`;
    await a.js(() => {
      const pic = (color) => { const k = document.createElement('canvas'); k.width = k.height = 200; const g = k.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 200, 200); return k.toDataURL('image/jpeg', 0.7); };
      db.equipment = [
        { id: 'p1', name: '', total: 5, rate: 2000, photo: pic('#c33'), note: '' }, // picture only
        { id: 'p2', name: 'سقالة', total: 10, rate: 1000, photo: pic('#3c3'), note: '' }, // name and picture
        { id: 'p3', name: 'مولدة', total: 2, rate: 0, photo: '', note: '' }, // name only, no price
      ];
      commit();
    });
    await a.page('equipment');
    eq(await a.p.$$eval('#list .rc img.thumb', (x) => x.length), 2, 'two cards with pictures');
    has(await a.text('#list'), T.no_name, 'unnamed product is listed');
    // the picker shows pictures; a picture-only product can be chosen
    await a.tab('rentals');
    await a.fab();
    await a.p.tap(`${SHEET} [data-pick-eq]`);
    await a.p.waitForSelector('.ov-picker:not(.closing) .eq-opt');
    await a.p.waitForTimeout(340);
    eq(await a.p.$$eval('.ov-picker:not(.closing) .eq-opt img', (x) => x.length), 2, 'pictures in the list');
    // back button closes only the list, the form stays
    await a.p.goBack();
    await a.p.waitForFunction(() => !document.querySelector('.ov-picker:not(.closing)'));
    eq(await a.p.isVisible(`${SHEET} [data-pick-eq]`), true, 'form still open');
    await a.pickEquipment(0, '', 2);
    has(await a.text(`${SHEET} [data-row]:nth-child(1) .eq-pick`), T.no_name, 'row shows the product');
    eq(await a.p.$$eval(`${SHEET} [data-row]:nth-child(1) .eq-pick img`, (x) => x.length), 1, 'row shows its picture');
    eq(await a.val('rate'), '2,000', 'its price is filled in');
    await a.p.tap(`${SHEET} [data-add-row]`); // the list opens by itself for the new line
    await a.pickEquipment(1, 'سقالة', 4);
    await a.p.tap(`${SHEET} [data-add-row]`);
    await a.pickEquipment(2, 'مولدة', 1);
    eq(await a.p.inputValue(`${SHEET} [data-row]:nth-child(3) [name=rate]`), '', 'no price stays empty');
    await a.p.tap(`${SHEET} [data-add-row]`);
    await a.p.waitForSelector('.ov-picker:not(.closing)');
    await a.p.waitForTimeout(340);
    await a.p.goBack(); // a new line the user changed their mind about
    await a.p.waitForFunction(() => !document.querySelector('.ov-picker:not(.closing)'));
    await a.set('start', '2026-11-02');
    eq(await a.text('#daily-sum'), c('8,000'), '2x2,000 + 4x1,000 + 1x0');
    await a.save();
    const rental = await a.js(() => db.rentals[0]);
    eq(rental.items.map((i) => [i.equipmentId, i.qty, i.rate]), [['p1', 2, 2000], ['p2', 4, 1000], ['p3', 1, 0]], 'unfinished line ignored');
    eq(JSON.stringify(rental).includes('data:image'), false, 'rentals do not copy the pictures');
    has(await a.text('#list .rc'), `${T.no_name} ×2 · سقالة ×4 · مولدة ×1`, 'card text');
    eq(await a.p.$$eval('#list .rc .mini-thumbs img', (x) => x.every((i) => i.complete) && x.length), 2, 'small pictures on the rental card');
    has(await a.text('#list .rc'), c('40,000'), '8,000 x 5');
    // partial return with pictures: the picture-only product comes back
    await a.p.tap('#list [data-act="return"]');
    await a.sheetOpen();
    eq(await a.p.$$eval(`${SHEET} .return-row img`, (x) => x.length), 2, 'pictures on return rows');
    await a.set('ret1', 0);
    await a.set('ret2', 0);
    eq(await a.val('total'), '20,000', '2 x 2,000 x 5');
    await a.save();
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    eq(await a.p.$$eval(`${SHEET} .line-item img`, (x) => x.length), 1, 'picture in the rental detail');
    await a.js(() => closeAll());
    await a.closed();
    // a line without a price: the total is typed at return, and reports follow it
    await a.p.tap('#list [data-act="return"]');
    await a.sheetOpen();
    eq(await a.val('total'), '20,000', '4 x 1,000 x 5 + 1 x 0');
    await a.set('total', 35000);
    await a.save();
    eq(await a.js(() => { const s = stats(monthRange(0)); return [s.rent, s.cash, s.rentN]; }), [55000, 55000, 2], 'rent and cash');
    await a.page('reports');
    eq(await a.p.$$eval('.rank-row img', (x) => x.length), 2, 'pictures in the top products');
    // backup carries the pictures to a new phone
    await a.page('settings');
    const [dl] = await Promise.all([a.p.waitForEvent('download'), a.p.tap('[data-act="backup-download"]')]);
    const file = await dl.path();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    eq(parsed.data.equipment.map((e) => !!e.photo), [true, true, false], 'pictures in the backup file');
    const copy = path.join(os.tmpdir(), `hareem-${Date.now()}.txt`);
    fs.copyFileSync(file, copy);
    await a.done();
    const b = await phone();
    await b.open();
    await b.p.waitForSelector('#welcome-form');
    const [fc] = await Promise.all([b.p.waitForEvent('filechooser'), b.p.tap('#w-restore')]);
    await fc.setFiles(copy);
    await b.p.waitForSelector('.nav a');
    await b.page('equipment');
    eq(await b.p.$$eval('#list .rc img.thumb', (x) => x.length), 2, 'pictures restored on the new phone');
    await b.p.waitForFunction(() => [...document.querySelectorAll('#list .rc img.thumb')].every((i) => i.complete && i.naturalWidth > 0));
    fs.rmSync(copy, { force: true });
    await b.done();
  });

  await test('optional: nothing is forced, unnamed records stay visible and correct', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    const c = (n) => `${n} ${T.currency}`;
    await a.page('equipment');
    // name only: no price needed
    await a.fab();
    await a.set('name', 'خلاطة');
    await a.save();
    eq(await a.js(() => [db.equipment[0].rate, db.equipment[0].total]), [0, 1], 'name alone is enough');
    // rental with no customer and no price
    await a.tab('rentals');
    await a.fab();
    await a.submit();
    eq(await a.err('items'), T.err_items, 'a rental still needs one item');
    await a.pickEquipment(0, 'خلاطة');
    await a.set('start', '2026-11-04');
    await a.save();
    eq(await a.js(() => db.customers.map((x) => x.name)), [T.unnamed_customer], 'unnamed customer account created');
    has(await a.text('#list .rc'), T.unnamed_customer, 'card says so');
    // return: type the amount, leave part unpaid: the debt stays visible
    await a.p.tap('#list [data-act="return"]');
    await a.sheetOpen();
    eq([await a.val('days'), await a.val('total'), await a.val('paid')], ['3', '0', '0'], 'no price means zero, not an error');
    await a.set('total', 30000);
    await a.set('paid', 10000);
    await a.save();
    await a.tab('debts');
    eq(await a.text('.hero-value'), c('20,000'), 'debt counted');
    has(await a.text('#list .rc'), T.unnamed_customer, 'debt listed under the unnamed account');
    // a second nameless record uses the same account, also after switching language
    await a.js(() => setLang('ku'));
    await a.p.tap('[data-act="new-debt"]');
    await a.sheetOpen();
    await a.set('amount', 5000);
    await a.save();
    await a.js(() => setLang('ar'));
    eq(await a.js(() => [db.customers.length, balances().get(db.customers[0].id)]), [1, 25000], 'one shared account');
    // payment without a name
    await a.p.tap('[data-act="new-payment"]');
    await a.sheetOpen();
    await a.submit();
    eq(await a.err('amount'), T.err_amount, 'an amount is still needed');
    await a.set('amount', 25000);
    await a.save();
    eq(await a.js(() => balances().get(db.customers[0].id)), 0, 'settled');
    // rename it into a real person, then new nameless records start a new account
    await a.page('customers');
    await a.p.tap('#list .rc-hit');
    await a.p.tap('[data-act="edit-customer"]');
    await a.sheetOpen();
    await a.set('name', 'حسن');
    await a.save();
    await a.tab('repairs');
    await a.fab();
    await a.set('problem', 'لا يشتغل');
    await a.save();
    eq(await a.js(() => db.customers.map((x) => x.name)), ['حسن', T.unnamed_customer], 'renamed customer keeps their records');
    // repair with only a problem written, delivered without a price
    const card = await a.text('#list .rc');
    has(card, T.no_name, 'repair without a machine name'); has(card, 'لا يشتغل', 'problem shown');
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-deliver]`);
    await a.sheetOpen();
    await a.save();
    eq(await a.js(() => { const p = db.repairs[0]; return [p.status, p.price, p.paid, repairDue(p)]; }), ['delivered', 0, 0, 0], 'delivered with no price');
    await a.page('reports');
    has(await a.text('.big-stat .v'), c('30,000'), 'reports still add up');
    // customer with a phone only
    await a.page('customers');
    await a.fab();
    await a.submit();
    eq(await a.err('name'), T.err_empty, 'completely empty is refused');
    await a.set('phone', '07501234567');
    await a.save();
    has(await a.text('#list'), '07501234567', 'phone stands in for the name');
    // a customer can also be named later on an existing rental's form
    eq(await a.js(() => db.customers.every((x) => x.name)), true, 'every customer has a label');
    await a.done();
  });

  await test('photos: 150 products with pictures stay fast on a slow phone', async () => {
    const a = await phone();
    await a.start();
    await a.js(() => {
      const k = document.createElement('canvas'); k.width = 480; k.height = 360;
      const g = k.getContext('2d');
      for (let i = 0; i < 900; i++) { g.fillStyle = `hsl(${i % 360},60%,${20 + (i % 60)}%)`; g.fillRect((i * 13) % 480, (i * 29) % 360, 14, 14); }
      const data = k.toDataURL('image/jpeg', 0.72);
      db.equipment = Array.from({ length: 150 }, (_, i) => ({ id: `e${i}`, name: i % 3 ? `معدة ${i}` : '', total: 100, rate: 1000, photo: `${data}`, note: '' }));
      db.customers = [{ id: 'c', name: 'س', phone: '' }];
      db.rentals = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, customerId: 'c', items: [{ equipmentId: `e${i}`, name: `معدة ${i}`, qty: 1, rate: 1000 }, { equipmentId: `e${i + 1}`, name: '', qty: 1, rate: 1000 }], start: '2026-11-01', advance: 0, note: '', returnDate: null }));
      commit();
    });
    await a.p.waitForTimeout(500);
    const cdp = await a.ctx.newCDPSession(a.p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const timed = (src) => a.js(async (code) => { const t0 = performance.now(); (0, eval)(code); document.body.getBoundingClientRect(); return Math.round(performance.now() - t0); }, src);
    const times = {
      equipment: await timed("goPage('equipment')"),
      rentals: await timed("goTab('rentals')"),
      home: await timed("goTab('home')"),
      picker: await timed("goTab('rentals'); rentalForm(); document.querySelector('.ov-sheet:not(.closing) [data-pick-eq]').click()"),
      saveMs: await a.js(async () => { const t0 = performance.now(); await writeDb(); return Math.round(performance.now() - t0); }),
      backupMs: await a.js(() => { const t0 = performance.now(); backupText(); return Math.round(performance.now() - t0); }),
    };
    const size = await a.js(() => Math.round(JSON.stringify(db).length / 1024 / 1024 * 10) / 10);
    console.log(`        times on a 4x slower CPU (ms): ${J(times)}; data ${size} MB, photo ${await a.js(() => Math.round(db.equipment[0].photo.length / 1024))} KB each`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    for (const [k, v] of Object.entries(times)) ok(v < 1500, `${k} too slow: ${v}ms`);
    // the list can be searched
    await a.p.fill('.ov-picker:not(.closing) input[type=search]', 'معدة 149');
    await a.p.waitForTimeout(60);
    eq(await a.p.$$eval('.ov-picker:not(.closing) .eq-opt:not([hidden])', (x) => x.map((o) => o.dataset.name)), ['معدة 149'], 'search in the list');
    await a.js(() => closeAll());
    await a.closed();
    await a.done();
  });

  await test('repairs: pending, ready, deliver, profit, edit, delete', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.js(() => { db.customers = [{ id: 'c1', name: 'أحمد الجبوري', phone: '', note: '' }]; commit(); });
    await a.tab('repairs');
    await a.fab();
    await a.submit();
    eq(await a.err('device'), T.err_empty, 'a completely empty form is not a record');
    await a.pickCustomer('احمد', 'أحمد الجبوري'); // typed without the hamza
    eq(await a.p.isVisible(`${SHEET} .combo-new`), false, 'no phone field for an existing customer');
    await a.set('device', 'دريل هلتي');
    await a.set('problem', 'السويج عاطل');
    await a.set('dateIn', '2026-11-05');
    await a.save();
    const c1 = await a.text('#list .rc');
    for (const x of ['دريل هلتي', 'أحمد الجبوري · السويج عاطل', '5 تشرين الثاني', 'منذ يومين', T.mark_ready]) has(c1, x, 'pending card');
    eq(await a.js(() => db.customers.length), 1, 'no duplicate customer');
    await a.p.tap('#list [data-act="ready"]');
    eq(await a.toast(), T.marked_ready, 'ready toast');
    eq(await a.text('#list'), T.no_repairs, 'moved out of pending');
    await a.p.tap('[data-act="seg"][data-val="ready"]');
    await a.p.tap('#list [data-act="deliver"]');
    await a.sheetOpen();
    await a.set('price', 45000);
    eq(await a.val('paid'), '45,000', 'paid follows price');
    await a.set('parts', 15000);
    eq(await a.text(`${SHEET} #profit`), `30,000 ${T.currency}`, 'profit');
    await a.set('paid', 30000);
    eq(await a.text(`${SHEET} #result`), `${T.to_debt} 15,000 ${T.currency}`, 'rest becomes debt');
    await a.set('dateOut', '2026-11-01');
    await a.submit();
    eq(await a.err('dateOut'), T.err_repair_dates, 'delivery before receipt blocked');
    await a.set('dateOut', '2026-11-07');
    await a.save();
    eq(await a.js(() => { const p = db.repairs[0]; return [p.status, p.price, p.parts, p.paid, p.dateOut, balances().get('c1')]; }), ['delivered', 45000, 15000, 30000, '2026-11-07', 15000], 'stored');
    await a.p.tap('[data-act="seg"][data-val="delivered"]');
    has(await a.text('#list .rc'), `${T.debt} 15,000 ${T.currency}`, 'delivered card');
    // edit a delivered repair: paying in full flips the chip to profit
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    const det = await a.text(`${SHEET} .sheet-body`);
    for (const x of [`45,000 ${T.currency}`, `15,000 ${T.currency}`, `30,000 ${T.currency}`, T.became_debt]) has(det, x, 'repair detail');
    await a.p.tap(`${SHEET} [data-edit]`);
    await a.sheetOpen();
    await a.set('paid', 45000);
    await a.save();
    has(await a.text('#list .rc'), `${T.profit} 30,000 ${T.currency}`, 'profit chip once paid');
    eq(await a.js(() => balances().get('c1')), 0, 'debt cleared');
    // direct delivery from pending, free of charge (price typed as 0)
    await a.fab();
    await a.pickCustomer('احمد');
    await a.set('device', 'جلاخة');
    await a.save();
    await a.p.tap('[data-act="seg"][data-val="pending"]');
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-deliver]`);
    await a.sheetOpen();
    await a.set('price', '0');
    eq(await a.val('price'), '0', 'zero is a valid price');
    await a.save();
    eq(await a.js(() => db.repairs[1].status), 'delivered', 'delivered directly');
    // delete
    await a.p.tap('[data-act="seg"][data-val="delivered"]');
    await a.p.tap('#list .rc:has-text("جلاخة") .rc-hit');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-del]`);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.closed();
    eq(await a.js(() => db.repairs.length), 1, 'deleted');
    await a.done();
  });

  await test('old records: equipment deleted later, losses, negative amounts', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.js(() => {
      db.equipment = [{ id: 'e1', name: 'خلاطة', total: 1, rate: 1000 }];
      db.customers = [{ id: 'c1', name: 'زبون', phone: '', note: '' }];
      db.rentals = [{ id: 'r1', customerId: 'c1', items: [{ equipmentId: 'gone', name: 'معدة محذوفة', qty: 2, rate: 1000 }, { equipmentId: 'e1', name: 'خلاطة', qty: 1, rate: 1000 }], start: '2026-10-01', advance: 0, note: '', returnDate: '2026-10-03', days: 2, total: 6000, paidAtReturn: 6000 }];
      db.repairs = [{ id: 'p1', customerId: 'c1', device: 'دريل', problem: '', dateIn: '2026-10-01', dateOut: '2026-10-02', price: 1000, parts: 3000, paid: 1000, status: 'delivered', note: '' }];
      commit();
    });
    await a.tab('rentals');
    await a.p.tap('[data-act="seg"][data-val="closed"]');
    has(await a.text('#list .rc'), 'معدة محذوفة ×2', 'old name still shown');
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-edit]`);
    await a.sheetOpen();
    eq([await a.p.inputValue(`${SHEET} [data-row]:nth-child(1) [name=eq]`), await a.text(`${SHEET} [data-row]:nth-child(1) .ep-name`)], ['gone', 'معدة محذوفة'], 'deleted equipment stays on the line');
    await a.set('note', 'تعديل');
    await a.save();
    eq(await a.js(() => db.rentals[0].items.map((i) => [i.equipmentId, i.name, i.qty])), [['gone', 'معدة محذوفة', 2], ['e1', 'خلاطة', 1]], 'nothing lost on save');
    // a repair that lost money looks like a loss
    await a.tab('repairs');
    await a.p.tap('[data-act="seg"][data-val="delivered"]');
    const chip = await a.p.$eval('#list .chip', (c) => [c.className.includes('chip-bad'), c.innerText.replace(/\s+/g, ' ')]);
    eq(chip[0], true, 'loss is red');
    // the minus stays on the left of the digits, in a line of right-to-left text
    const order = await a.js(() => { const c = document.querySelector('#list .chip'); const r = document.createRange(); const n = c.firstChild; const s = n.textContent; const i = s.indexOf('-'); r.setStart(n, i); r.setEnd(n, i + 1); const minus = r.getBoundingClientRect(); r.setStart(n, i + 1); r.setEnd(n, i + 2); const digit = r.getBoundingClientRect(); return minus.right <= digit.left + 1; });
    eq(order, true, 'minus sign on the left');
    eq(T.profit.length > 0, true, 'text');
    await a.done();
  });

  await test('debts: totals, partial payments, manual debt, credit, edit, delete', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.js(seedKnown);
    await a.tab('debts');
    eq(await a.text('.hero-value'), `110,000 ${T.currency}`, 'total debts');
    has(await a.text('.hero-sub'), '2', 'debtors');
    let cards = await a.texts('#list .rc');
    ok(cards[0].includes('كاك ئازاد') && cards[0].includes('70,000'), 'largest first');
    ok(cards[1].includes('أحمد') && cards[1].includes('40,000'), 'second');
    // payment: picker lists the biggest debtor first
    await a.p.tap('[data-act="new-payment"]');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [name=customerName]`);
    await a.p.waitForSelector(`${SHEET} .combo-opt`);
    has((await a.texts(`${SHEET} .combo-opt`))[0], 'كاك ئازاد', 'debtor first');
    await a.p.tap(`${SHEET} .combo-opt:has-text("أحمد")`);
    eq(await a.text(`${SHEET} #cur-debt`), `${T.current_debt} 40,000 ${T.currency}`, 'current debt');
    await a.submit();
    eq(await a.err('amount'), T.err_amount, 'amount required');
    await a.set('amount', 15000);
    eq(await a.text(`${SHEET} #result`), `${T.after_payment} 25,000 ${T.currency}`, 'remaining preview');
    await a.save();
    eq(await a.toast(), T.payment_saved, 'toast');
    eq(await a.js(() => balances().get('c1')), 25000, 'instalment applied');
    // pay all
    await a.p.tap('[data-act="new-payment"]');
    await a.sheetOpen();
    await a.pickCustomer('احمد');
    await a.p.tap(`${SHEET} [data-fill-all]`);
    eq(await a.val('amount'), '25,000', 'fills whole debt');
    eq(await a.text(`${SHEET} #result`), T.settled, 'settled preview');
    await a.save();
    cards = await a.texts('#list .rc');
    eq(cards.length, 1, 'settled customer leaves the list');
    // manual debt, including a brand-new customer
    await a.p.tap('[data-act="new-debt"]');
    await a.sheetOpen();
    await a.newCustomer('جعفر', '07501112233');
    await a.set('amount', 9000);
    await a.set('note', 'أجور نقل');
    await a.save();
    eq(await a.toast(), T.debt_saved, 'toast');
    eq(await a.js(() => balances().get(db.customers.find((c) => c.name === 'جعفر').id)), 9000, 'manual debt');
    // customer page, history order, editing and deleting an entry
    await a.p.tap('#list .rc:has-text("جعفر") .rc-hit');
    eq(await a.text('.tb-title h1'), 'جعفر', 'customer page');
    eq(await a.text('.balance'), `${T.owes} 9,000 ${T.currency}`, 'balance');
    eq(await a.p.getAttribute('.phone-link', 'href'), 'tel:07501112233', 'call link');
    await a.p.tap('.profile [data-act="new-payment"]');
    await a.sheetOpen();
    eq(await a.val('customerName'), 'جعفر', 'customer prefilled');
    await a.set('amount', 12000); // more than owed
    eq(await a.text(`${SHEET} #result`), `${T.credit} 3,000 ${T.currency}`, 'overpayment preview');
    await a.save();
    eq(await a.text('.balance'), `${T.credit} 3,000 ${T.currency}`, 'credit shown');
    const hist = await a.texts('.list .rc');
    eq(hist.length, 2, 'history entries');
    await a.p.tap('.list .rc:has-text("12,000") .rc-hit');
    await a.sheetOpen();
    await a.set('amount', 4000);
    await a.save();
    eq(await a.text('.balance'), `${T.owes} 5,000 ${T.currency}`, 'edit applied');
    await a.p.tap('.list .rc:has-text("4,000") .rc-hit');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-del]`);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.closed();
    eq(await a.text('.balance'), `${T.owes} 9,000 ${T.currency}`, 'delete applied');
    await a.done();
  });

  await test('customers: duplicates, rename, delete rules, search', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.js(seedKnown);
    await a.page('customers');
    await a.fab();
    await a.submit();
    eq(await a.err('name'), T.err_empty, 'needs a name or a phone');
    await a.set('name', 'احمد'); // same as أحمد
    await a.submit();
    eq(await a.err('name'), T.customer_exists, 'duplicate blocked');
    await a.set('name', 'سامي');
    await a.set('phone', '٠٧٨١٢٣');
    await a.save();
    eq(await a.js(() => db.customers.find((c) => c.name === 'سامي').phone), '078123', 'phone digits normalized');
    // search by name variants and by phone
    await a.p.fill('[data-search="customers"]', 'كاك');
    eq((await a.texts('#list .rc')).length, 1, 'search by name');
    await a.p.fill('[data-search="customers"]', 'ک'); // Kurdish keheh finds Arabic kaf too
    has(await a.text('#list'), 'كاك ئازاد', 'letter variants match');
    await a.p.fill('[data-search="customers"]', '0781');
    has(await a.text('#list'), 'سامي', 'search by phone');
    await a.p.fill('[data-search="customers"]', '٠٧٨١');
    has(await a.text('#list'), 'سامي', 'search by phone in Arabic digits');
    await a.p.fill('[data-search="customers"]', 'zzz');
    eq(await a.text('#list'), T.no_results, 'no results');
    await a.p.fill('[data-search="customers"]', '');
    // rename shows up on rentals
    await a.p.tap('#list .rc:has-text("أحمد") .rc-hit');
    await a.p.tap('[data-act="edit-customer"]');
    await a.sheetOpen();
    await a.set('name', 'أحمد علي');
    await a.save();
    eq(await a.text('.tb-title h1'), 'أحمد علي', 'renamed page');
    await a.tab('rentals');
    await a.p.tap('[data-act="seg"][data-val="closed"]');
    has(await a.text('#list'), 'أحمد علي', 'rename reaches records');
    // customer with records can't be deleted
    await a.page('customers');
    await a.p.tap('#list .rc:has-text("أحمد علي") .rc-hit');
    await a.p.tap('[data-act="edit-customer"]');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-del]`);
    await a.dialogOpen();
    has(await a.text(DIALOG), T.customer_has_records, 'blocked');
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.p.waitForTimeout(400);
    await a.js(() => closeAll());
    await a.closed();
    eq(await a.js(() => db.customers.length), 3, 'still there');
    // customer without records can be, and the page goes back to the list
    await a.p.tap('[data-act="back"]');
    await a.p.waitForFunction(() => location.hash === '#/customers');
    await a.p.tap('#list .rc:has-text("سامي") .rc-hit');
    await a.p.tap('[data-act="edit-customer"]');
    await a.sheetOpen();
    await a.p.tap(`${SHEET} [data-del]`);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.closed();
    await a.p.waitForFunction(() => location.hash === '#/customers');
    eq(await a.js(() => db.customers.length), 2, 'deleted');
    hasNot(await a.text('#list'), 'سامي', 'gone from the list');
    await a.done();
  });

  await test('times: exact moment of every action, activity log, edits, deletes', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    const at = (hms, day = '2026-11-07') => a.ctx.clock.setFixedTime(new Date(`${day}T${hms}+03:00`));
    const logged = () => a.js(() => db.log.map((e) => `${e.k} ${new Date(e.at).toTimeString().slice(0, 8)}`));
    const rowsNow = () => a.p.$$eval('#list .log-row', (rs) => rs.map((r) => [r.querySelector('.log-time').textContent.replace(/\s+/g, ' '), r.querySelector('.log-title').childNodes[0].textContent.trim(), r.querySelector('.chip') ? 'deleted' : r.tagName === 'BUTTON' ? 'opens' : '-']));
    eq(await a.js(() => [0, 5, 11, 12, 13, 23].map((h) => fmtTime(new Date(2026, 10, 7, h, 4, 9).getTime(), true).replace('\u00A0', ' '))),
      ['12:04:09 ص', '5:04:09 ص', '11:04:09 ص', '12:04:09 م', '1:04:09 م', '11:04:09 م'], '12-hour clock: midnight, morning, noon, evening');
    eq(await logged(), [], 'nothing logged before any action');

    // a product at 9:05:07 in the morning
    await at('09:05:07');
    await a.page('equipment');
    await a.addEquipment('خلاطة', 3, 25000);
    eq(await logged(), ['eq_new 09:05:07'], 'new product logged to the second');

    // two mixers go out at 2:30:15 pm to a new customer
    await at('14:30:15');
    await a.tab('rentals');
    await a.fab();
    await a.newCustomer('أحمد');
    await a.pickEquipment(0, 'خلاطة', 2);
    await a.save();
    eq((await logged()).slice(1), ['cust_new 14:30:15', 'rent 14:30:15'], 'customer and rental logged');
    has(await a.text('#list .rc .rc-meta'), '7 تشرين الثاني · 2:30 م', 'open card: the time it went out');
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    let det = await a.text(`${SHEET} .sheet-body`);
    has(det, `${T.start_date} السبت، 7 تشرين الثاني 2026 · 2:30:15 م`, 'detail: start day and time to the second');
    hasNot(det, T.recorded_at, 'entered the same day: the start time says it all');
    hasNot(det, T.edited_at, 'not edited yet');
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.closed();

    // saving the form unchanged is not an edit; a real change is
    const rid = await a.js(() => db.rentals[0].id);
    await at('15:00:00');
    await a.js((id) => rentalForm(id), rid);
    await a.sheetOpen();
    await a.save();
    eq(await a.js(() => [db.log.length, db.rentals[0].editedAt || 0]), [3, 0], 'unchanged save: no edit recorded');
    await a.js((id) => rentalForm(id), rid);
    await a.sheetOpen();
    await a.set('note', 'موقع العمل');
    await a.save();
    eq((await logged()).slice(-1), ['rent_edit 15:00:00'], 'a real edit is logged');
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    has(await a.text(`${SHEET} .sheet-body`), `${T.edited_at} السبت، 7 تشرين الثاني 2026 · 3:00:00 م`, 'detail: last edit');
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.closed();

    // one mixer comes back at 4:45 pm
    await at('16:45:00');
    await a.p.tap('#list [data-act="return"]');
    await a.sheetOpen();
    await a.set('ret0', 1);
    await a.save();
    eq(await a.js(() => db.rentals.map((r) => [r.items[0].qty, new Date(r.createdAt).toTimeString().slice(0, 8), r.returnedAt ? new Date(r.returnedAt).toTimeString().slice(0, 8) : '-'])),
      [[1, '14:30:15', '-'], [1, '14:30:15', '16:45:00']], 'the returned part keeps the moment it went out');
    await a.p.tap('[data-act="seg"][data-val="closed"]');
    has(await a.text('#list .rc .rc-meta'), '7 تشرين الثاني ← 7 تشرين الثاني · 4:45 م', 'closed card: the time it came back');

    // a repair: received 5:00, ready 5:10:20, delivered 6:00:05
    await at('17:00:00');
    await a.tab('repairs');
    await a.fab();
    await a.pickCustomer('احمد', 'أحمد');
    await a.set('device', 'دريل');
    await a.save();
    has(await a.text('#list .rc .rc-meta'), '7 تشرين الثاني · 5:00 م', 'repair card: time received');
    await at('17:10:20');
    await a.p.tap('#list [data-act="ready"]');
    await a.clearToast();
    await at('18:00:05');
    await a.p.tap('[data-act="seg"][data-val="ready"]');
    await a.p.tap('#list [data-act="deliver"]');
    await a.sheetOpen();
    await a.set('price', 10000);
    await a.save();
    await a.p.tap('[data-act="seg"][data-val="delivered"]');
    has(await a.text('#list .rc .rc-meta'), '7 تشرين الثاني · 6:00 م', 'delivered card: time delivered');
    await a.p.tap('#list .rc-hit');
    await a.sheetOpen();
    det = await a.text(`${SHEET} .sheet-body`);
    has(det, `${T.date_in} السبت، 7 تشرين الثاني 2026 · 5:00:00 م`, 'detail: received');
    has(det, `${T.ready_at} السبت، 7 تشرين الثاني 2026 · 5:10:20 م`, 'detail: ready, to the second');
    has(det, `${T.date_out} السبت، 7 تشرين الثاني 2026 · 6:00:05 م`, 'detail: delivered, to the second');
    ok(await a.js(() => [...document.querySelectorAll('.ov-sheet:not(.closing) .kv .v')].every((v) => !/\d\s*$/.test(v.innerText.split('\n')[0]) || !/^[صم]/.test(v.innerText.split('\n')[1] || ''))), 'the time never splits from ص/م');
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.closed();

    // a debt at 7:20 pm and a payment at 7:21:30 pm, then the payment is deleted at 7:25
    const cid = await a.js(() => db.customers[0].id);
    await at('19:20:00');
    await a.js((id) => goPage('customer', id), cid);
    await a.p.tap('[data-act="new-debt"]');
    await a.sheetOpen();
    await a.set('amount', 5000);
    await a.save();
    await at('19:21:30');
    await a.p.tap('[data-act="new-payment"]');
    await a.sheetOpen();
    await a.set('amount', 2000);
    await a.save();
    const hist = await a.text('#view');
    has(hist, '7 تشرين الثاني · 7:20 م', 'debt line: its time');
    has(hist, '7 تشرين الثاني · 7:21 م', 'payment line: its time');
    await at('19:25:00');
    await a.p.tap('#view .rc:has(.hist-ic.pay) .rc-hit');
    await a.sheetOpen();
    has(await a.text(`${SHEET} .rec-hint`), `${T.recorded_at}: السبت، 7 تشرين الثاني 2026 · 7:21:30 م`, 'edit form: when it was recorded');
    await a.p.tap(`${SHEET} [data-del]`);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.closed();

    // the activity page: newest first, each to the second
    await a.page('activity');
    eq(await a.texts('.day-head'), [`${T.today} · السبت، 7 تشرين الثاني 2026`], 'one day, called today');
    eq(await rowsNow(), [
      ['7:25:00 م', T.log_pay_del, '-'],
      ['7:21:30 م', T.record_payment, 'deleted'],
      ['7:20:00 م', T.add_debt, 'opens'],
      ['6:00:05 م', T.deliver_title, 'opens'],
      ['5:10:20 م', T.marked_ready, 'opens'],
      ['5:00:00 م', T.new_repair, 'opens'],
      ['4:45:00 م', T.log_return_part, 'opens'],
      ['3:00:00 م', T.edit_rental, 'opens'],
      ['2:30:15 م', T.new_rental, 'opens'],
      ['2:30:15 م', T.new_customer, 'opens'],
      ['9:05:07 ص', T.new_equipment, 'opens'],
    ], 'every action, newest first');
    const rows = await a.texts('#list .log-row');
    has(rows[0], `${T.log_pay_del} 2,000 ${T.currency} أحمد`, 'deleted payment: how much and whose');
    has(rows[6], `أحمد · خلاطة ×1`, 'partial return: what came back');
    has(rows[6], `${T.paid} `, 'partial return: what was paid');
    has(rows[8], `أحمد · خلاطة ×2`, 'rental: what went out');
    await a.p.tap('[data-act="seg"][data-val="repairs"]');
    eq((await rowsNow()).map((r) => r[1]), [T.deliver_title, T.marked_ready, T.new_repair], 'repairs only');
    await a.p.tap('[data-act="seg"][data-val="money"]');
    eq((await rowsNow()).map((r) => r[1]), [T.log_pay_del, T.record_payment, T.add_debt], 'money only');
    await a.p.tap('[data-act="seg"][data-val="all"]');
    await a.p.fill('[data-search="activity"]', 'دريل');
    await a.p.waitForTimeout(250);
    eq((await rowsNow()).map((r) => r[1]), [T.deliver_title, T.marked_ready, T.new_repair], 'search by what');
    await a.p.fill('[data-search="activity"]', '');
    await a.p.waitForTimeout(250);
    await a.p.tap('#list .log-row[data-target="rental"]');
    await a.sheetOpen();
    has(await a.text(`${SHEET} .sheet-body`), `${T.return_date} السبت، 7 تشرين الثاني 2026 · 4:45:00 م`, 'tapping a row opens that record');
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.closed();

    // home shows the last five under their day
    await a.tab('home');
    await a.p.waitForFunction(() => location.hash === '#/home' && !!document.querySelector('#view .log-row'));
    has(await a.text('#view'), T.recent_activity, 'home: recent actions');
    eq(await a.p.$$eval('#view .log-row', (x) => x.length), 5, 'home: five of them');

    // the next morning they are yesterday's
    await at('08:00:00', '2026-11-08');
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    await a.page('activity');
    eq(await a.texts('.day-head'), [`${T.yesterday} · السبت، 7 تشرين الثاني 2026`], 'yesterday');
    await a.tab('rentals');
    await a.p.tap('[data-act="seg"][data-val="open"]');
    has(await a.text('#list .rc .rc-meta'), '7 تشرين الثاني · 2:30 م', 'the time stays on the card the next day');

    // Kurdish: same moments in Kurdish words
    await a.js(() => setLang('ku'));
    const K = await a.T('ku');
    await a.page('activity');
    eq((await rowsNow())[0], ['7:25:00 د.ن', K.log_pay_del, '-'], 'Kurdish clock words and titles');
    eq((await rowsNow())[10], ['9:05:07 ب.ن', K.new_equipment, 'opens'], 'Kurdish morning');
    ok((await a.texts('.day-head'))[0].startsWith(`${K.yesterday} · `), 'Kurdish yesterday');
    eq(await a.js(() => [logWhat({ k: 'eq_new' }), logWhat({ k: 'rent', i: [['', 2]] })]), [K.no_name, `${K.no_name} ×2`], 'a missing name reads in the language in use');
    await a.js(() => setLang('ar'));

    // a rental entered today for a day that already passed: no time on the card, the moment it was entered in the detail
    await at('08:05:00', '2026-11-08');
    await a.tab('rentals');
    await a.fab();
    await a.pickCustomer('احمد', 'أحمد');
    await a.pickEquipment(0, 'خلاطة', 1);
    await a.set('start', '2026-11-06');
    await a.save();
    const late = await a.texts('#list .rc .rc-meta');
    ok(late.some((x) => x.includes('6 تشرين الثاني') && !x.includes(':')), 'back-dated card: day only', J(late));
    await a.p.tap('#list .rc:has-text("6 تشرين الثاني") .rc-hit');
    await a.sheetOpen();
    det = await a.text(`${SHEET} .sheet-body`);
    has(det, `${T.start_date} الجمعة، 6 تشرين الثاني 2026 ${T.days_count}`, 'back-dated: the start day has no time');
    has(det, `${T.recorded_at} الأحد، 8 تشرين الثاني 2026 · 8:05:00 ص`, 'back-dated: when it was really entered');
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.closed();

    // limits and old data
    eq(await a.js(() => {
      const keep = db.log;
      db.log = [];
      for (let i = 0; i < LOG_MAX + 5; i++) logAction('backup', { n: String(i) });
      const out = [db.log.length, db.log[0].n, db.log[db.log.length - 1].n];
      db.log = keep;
      return out;
    }), [20000, '5', '20004'], 'the oldest actions drop off after 20,000');
    eq(await a.js(() => normalizeDb({ equipment: [], customers: [], rentals: [], repairs: [], ledger: [] }).log), [], 'a backup from before this version restores with an empty log');
    eq(await a.js(() => JSON.parse(backupText()).data.log.length === db.log.length), true, 'backups carry the log');
    await a.done();
  });

  await test('reports: every number matches the hand calculation', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.js(seedKnown);
    // home tiles
    eq(await a.text('.hero-value'), `110,000 ${T.currency}`, 'home debts');
    const tiles = await a.texts('.stats .stat');
    has(tiles[0], '1', 'open rentals'); has(tiles[0], `25,000 ${T.currency}`, 'accrued so far');
    has(tiles[1], '1', 'in repair');
    has(tiles[2], `295,000 ${T.currency}`, 'rent this month');
    has(tiles[3], `30,000 ${T.currency}`, 'repair profit this month');
    await a.page('reports');
    const read = async () => ({ net: await a.text('.big-stat .v'), tiles: (await a.texts('.stats .stat .stat-v')) });
    const c = (n) => `${n} ${T.currency}`;
    let r = await read();
    eq(r, { net: c('325,000'), tiles: [c('295,000'), c('45,000'), c('15,000'), c('30,000'), c('260,000')] }, 'this month');
    has((await a.texts('.rank-row')).join('|'), `سقالة ${c('195,000')}|خلاطة ${c('100,000')}`, 'top equipment this month');
    await a.p.tap('[data-act="seg"][data-val="last"]');
    r = await read();
    eq(r, { net: c('120,000'), tiles: [c('130,000'), c('80,000'), c('90,000'), c('-10,000'), c('260,000')] }, 'last month');
    has((await a.texts('.rank-row')).join('|'), `خلاطة ${c('100,000')}|سقالة ${c('30,000')}`, 'top equipment splits a rental by share');
    await a.p.tap('[data-act="seg"][data-val="year"]');
    r = await read();
    eq(r, { net: c('495,000'), tiles: [c('475,000'), c('125,000'), c('105,000'), c('20,000'), c('570,000')] }, 'this year');
    await a.p.tap('[data-act="seg"][data-val="all"]');
    r = await read();
    eq(r, { net: c('511,000'), tiles: [c('481,000'), c('135,000'), c('105,000'), c('30,000'), c('586,000')] }, 'all time');
    // chart
    eq(await a.js(() => [...document.querySelectorAll('.chart .col .xl')].map((x) => x.textContent)), ['حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني'], 'six months, oldest first');
    has(await a.text('#readout'), 'تشرين الثاني 2026', 'current month selected');
    has(await a.text('#readout'), c('325,000'), 'readout total');
    await a.p.tap('.chart .col[data-i="4"]');
    has(await a.text('#readout'), 'تشرين الأول 2026', 'tap selects a month');
    has(await a.text('#readout'), c('-10,000'), 'loss shown in the readout');
    const bars = await a.js(() => [...document.querySelectorAll('.chart .col')].map((c) => [c.querySelectorAll('.s1').length, c.querySelectorAll('.s2').length]));
    eq(bars, [[0, 0], [0, 0], [0, 0], [0, 0], [1, 0], [1, 1]], 'bars only where there is data, losses draw nothing');
    await a.p.tap('.tbl summary');
    const rows = await a.js(() => [...document.querySelectorAll('table.data tbody tr')].slice(0, 2).map((r) => [...r.cells].map((x) => x.textContent.replace(/\u200E/g, ''))));
    eq(rows, [['تشرين الثاني 2026', '295,000', '30,000', '325,000'], ['تشرين الأول 2026', '130,000', '-10,000', '120,000']], 'number table');
    await a.done();
  });

  await test('dates: month and year boundaries, leap day, Kurdish format', async () => {
    const a = await phone({ now: '2027-01-15T23:59:30+03:00' });
    await a.start();
    await a.js(() => { db.customers = [{ id: 'c', name: 'س', phone: '' }]; db.rentals = [{ id: 'r', customerId: 'c', items: [{ equipmentId: 'e', name: 'م', qty: 1, rate: 1000 }], start: '2026-12-20', advance: 0, returnDate: '2026-12-25', days: 5, total: 5000, paidAtReturn: 5000 }]; commit(); });
    await a.page('reports');
    eq(await a.js(() => [...document.querySelectorAll('.chart .col .xl')].map((x) => x.textContent)), ['آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول', 'كانون الثاني'], 'months cross the new year');
    await a.p.tap('[data-act="seg"][data-val="last"]');
    has(await a.text('.big-stat .v'), '5,000', 'last month is December of last year');
    await a.p.tap('[data-act="seg"][data-val="year"]');
    has(await a.text('.big-stat .v'), '0', 'this year starts empty');
    eq(await a.js(() => [today(), daysBetween('2028-02-28', '2028-03-01'), daysBetween('2027-02-28', '2027-03-01'), rentDays('2026-12-31', '2027-01-01'), rentDays('2027-01-15', '2027-01-15')]), ['2027-01-15', 2, 1, 1, 1], 'day counting');
    eq(await a.js(() => { lang = 'ku'; const o = [fmtDate('2027-01-15'), fmtDate('2026-11-03'), fmtDate('2027-02-05', true), L().since(0), L().since(3), L().days(3)]; lang = 'ar'; return o; }),
      ['15ی کانوونی دووەم', '3ی تشرینی دووەمی 2026', 'هەینی، 5ی شوباتی 2027', 'ئەمڕۆ', '3 ڕۆژە', '3 ڕۆژ'], 'Kurdish dates');
    eq(await a.js(() => [fmtDate('2027-01-15'), fmtDate('2026-11-03'), fmtDate('2027-02-05', true), L().since(0), L().since(1), L().since(2), L().since(7), L().since(11), L().days(1), L().days(2), L().days(10), L().days(11), L().days(100)]),
      ['15 كانون الثاني', '3 تشرين الثاني 2026', 'الجمعة، 5 شباط 2027', 'اليوم', 'منذ يوم', 'منذ يومين', 'منذ 7 أيام', 'منذ 11 يوماً', 'يوم واحد', 'يومان', '10 أيام', '11 يوماً', '100 يوم'], 'Arabic dates and plurals');
    await a.done();
  });

  await test('numbers: typing, pasting, digits of every keyboard, large amounts', async () => {
    const a = await phone();
    await a.start();
    await a.page('equipment');
    await a.fab();
    const typed = async (v) => { await a.set('rate', v); return a.val('rate'); };
    eq(await typed('1250000'), '1,250,000', 'groups thousands');
    eq(await typed('1,250,000'), '1,250,000', 'pasted with commas');
    eq(await typed('١٢٣٤'), '1,234', 'Arabic digits');
    eq(await typed('۱۲۳۴'), '1,234', 'Kurdish digits');
    eq(await typed('abc'), '', 'letters refused');
    eq(await typed('12.5'), '125', 'no decimals in dinars');
    eq(await typed('-500'), '500', 'no negatives');
    eq(await typed('999999999999999'), '999,999,999,999', 'capped at 12 digits');
    eq(await a.js(() => [toInt('1,000'), toInt('٣٤'), toInt(''), toInt('-5,000'), num(0), num(-5000).replace('\u200E', ''), num(1234567), compact(0), compact(950), compact(1500), compact(2500000), compact(25000000)]),
      [1000, 34, 0, -5000, '0', '-5,000', '1,234,567', '0', '950', '2 ألف', '2.5 مليون', '25 مليون'], 'number helpers');
    await a.js(() => closeAll());
    await a.closed();
    await a.done();
  });

  await test('safety: names with code or symbols stay plain text', async () => {
    const a = await phone();
    await a.start();
    const evil = '<img src=x onerror="window.__xss=1"> & "قوس" \'x\'';
    await a.js((name) => {
      db.equipment = [{ id: 'e1', name, total: 2, rate: 1000 }];
      db.customers = [{ id: 'c1', name, phone: '<b>07</b>', note: name }];
      db.rentals = [{ id: 'r1', customerId: 'c1', items: [{ equipmentId: 'e1', name, qty: 1, rate: 1000 }], start: '2026-11-01', advance: 0, note: name, returnDate: null }];
      db.repairs = [{ id: 'p1', customerId: 'c1', device: name, problem: name, dateIn: '2026-11-01', dateOut: '2026-11-02', price: 1, parts: 0, paid: 0, status: 'delivered', note: name }];
      db.ledger = [{ id: 'l1', customerId: 'c1', type: 'debt', amount: 5, date: '2026-11-01', note: name }];
      commit();
    }, evil);
    await a.tab('rentals');
    await a.tab('repairs');
    await a.p.tap('[data-act="seg"][data-val="delivered"]');
    has(await a.text('#list'), '<img src=x', 'repair card shows it literally');
    await a.tab('debts');
    await a.js(() => { rentalForm('r1'); });
    await a.sheetOpen();
    await a.js(() => closeAll()); await a.closed();
    await a.js(() => { rentalDetail('r1'); }); await a.sheetOpen(); await a.js(() => closeAll()); await a.closed();
    await a.js(() => { repairDetail('p1'); }); await a.sheetOpen(); await a.js(() => closeAll()); await a.closed();
    await a.js(() => { goPage('customer', 'c1'); });
    await a.p.waitForTimeout(100);
    eq(await a.js(() => [window.__xss === undefined, document.querySelectorAll('#view img, #view b').length]), [true, 0], 'no code ran, no element injected');
    has(await a.text('.tb-title h1'), '<img src=x', 'shown literally');
    await a.done();
  });

  await test('settings: language, name, theme persist across restart', async () => {
    const a = await phone();
    await a.start();
    await a.page('settings');
    await a.p.tap('[data-act="set-lang"][data-lang="ku"]');
    eq(await a.text('.tb-title h1'), 'ڕێکخستنەکان', 'kurdish now');
    await a.p.tap('[data-act="set-theme"][data-theme="dark"]');
    eq(await a.js(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor, [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content)]), ['dark', 'rgb(14, 12, 11)', ['#0E0C0B', '#0E0C0B']], 'dark applied');
    await a.p.fill('#shop-name', 'هەرێم');
    await a.p.press('#shop-name', 'Enter');
    await a.p.waitForTimeout(100);
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => [lang, db.settings.shopName, document.documentElement.dataset.theme, document.documentElement.lang]), ['ku', 'هەرێم', 'dark', 'ckb'], 'all kept after restart');
    await a.tab('home');
    await a.p.waitForFunction(() => route.name === 'home');
    eq(await a.text('.tb-title h1'), 'هەرێم', 'name in header');
    await a.page('settings');
    await a.p.fill('#shop-name', '');
    await a.p.press('#shop-name', 'Enter');
    await a.tab('home');
    await a.p.waitForFunction(() => route.name === 'home');
    eq(await a.text('.tb-title h1'), 'هریم', 'empty name falls back to هريم');
    await a.p.tap('[data-act="toggle-lang"]');
    eq(await a.text('.tb-title h1'), 'هريم', 'arabic form');
    await a.done();
  });

  await test('PIN: set, mismatch, lock on open, wrong code, keyboard, auto-lock, remove', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.page('settings');
    await a.p.tap('[data-act="pin-on"]');
    await a.sheetOpen();
    const press = async (digits, scope) => { for (const k of digits) await a.p.tap(`${scope} [data-key="${k}"]`); await a.p.waitForTimeout(220); };
    eq(await a.text('#ps-sub'), T.pin_new, 'prompt');
    await press('1234', SHEET);
    eq(await a.text('#ps-sub'), T.pin_repeat, 'repeat');
    await press('1235', SHEET);
    eq(await a.text('#ps-sub'), T.pin_mismatch, 'mismatch');
    await press('4321', SHEET);
    await press('4321', SHEET);
    await a.closed();
    eq(await a.toast(), T.pin_enabled, 'enabled');
    const stored = await a.js(() => localStorage.getItem('daftar-mahal.pin'));
    hasNot(stored, '4321', 'code is not stored in clear');
    // lock on open hides everything
    await a.p.reload();
    await a.p.waitForSelector('.lock');
    eq(await a.js(() => document.querySelector('#app').hidden), true, 'app hidden behind the lock');
    await press('0000', '.lock');
    eq(await a.text('#lock-sub'), T.pin_wrong, 'wrong code');
    eq(await a.js(() => !!document.querySelector('.lock')), true, 'still locked');
    await press('4321', '.lock');
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => [!!document.querySelector('.lock'), locked]), [false, false], 'opened');
    // comes back after a minute in the background, not sooner
    const hide = (state) => a.js((s) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s }); document.dispatchEvent(new Event('visibilitychange')); }, state);
    await hide('hidden');
    await a.ctx.clock.setFixedTime(new Date('2026-11-07T10:00:30+03:00'));
    await hide('visible');
    await a.p.waitForTimeout(50);
    eq(await a.js(() => !!document.querySelector('.lock')), false, 'no lock after 30 s');
    await hide('hidden');
    await a.ctx.clock.setFixedTime(new Date('2026-11-07T10:02:00+03:00'));
    await hide('visible');
    await a.p.waitForSelector('.lock');
    await a.p.keyboard.type('4321'); // hardware keyboard also works
    await a.p.waitForFunction(() => !document.querySelector('.lock'));
    // removing it needs the code
    await a.p.tap('[data-act="pin-off"]');
    await a.sheetOpen();
    await press('1111', SHEET);
    eq(await a.text('#ps-sub'), T.pin_wrong, 'wrong code keeps it');
    await press('4321', SHEET);
    await a.closed();
    eq(await a.js(() => localStorage.getItem('daftar-mahal.pin')), null, 'removed');
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    await a.done();
  });

  await test('backup: real file download, share sheet, restore, bad files, wipe', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.js(seedKnown);
    await a.page('settings');
    has(await a.text('#view'), T.no_backup_yet, 'no backup yet');
    // real download
    const [dl] = await Promise.all([a.p.waitForEvent('download'), a.p.tap('[data-act="backup-download"]')]);
    eq(dl.suggestedFilename(), 'hareem-backup-2026-11-07.txt', 'file name');
    const file = await dl.path();
    const text = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(text);
    eq([parsed.app, parsed.data.rentals.length, parsed.data.repairs.length, parsed.data.ledger.length, parsed.data.customers.length, parsed.data.equipment.length], ['daftar-mahal', 6, 4, 2, 2, 2], 'file holds everything');
    eq(await a.toast(), T.backup_ready, 'toast');
    ok(Array.isArray(parsed.data.log), 'file holds the activity log');
    eq(await a.js(() => db.log[db.log.length - 1].k), 'backup', 'the backup itself is logged');
    has(await a.text('#view'), T.last_backup.replace('{d}', '7 تشرين الثاني'), 'last backup date');
    // Google Drive path: the phone's share sheet receives a .txt file (Chrome refuses .json)
    await a.js(() => {
      window.__shared = [];
      navigator.canShare = (d) => d.files.every((f) => f.type === 'text/plain');
      navigator.share = async (d) => { window.__shared.push({ name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text() }); };
    });
    await a.p.tap('[data-act="backup-share"]');
    await a.p.waitForFunction(() => window.__shared.length === 1);
    const shared = await a.js(() => window.__shared[0]);
    eq([shared.name, shared.type, JSON.parse(shared.text).data.rentals.length], ['hareem-backup-2026-11-07.txt', 'text/plain', 6], 'shared file');
    // user cancels the share sheet: nothing happens, no download
    await a.clearToast();
    await a.js(() => { navigator.share = async () => { throw new DOMException('cancel', 'AbortError'); }; });
    await a.p.tap('[data-act="backup-share"]');
    await a.p.waitForTimeout(200);
    eq(await a.js(() => document.querySelector('#toast').classList.contains('show')), false, 'cancel is silent');
    // bad files are refused and change nothing
    const tmp = path.join(os.tmpdir(), `hareem-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    const put = (n, c) => { const f = path.join(tmp, n); fs.writeFileSync(f, c); return f; };
    const feed = async (f) => { const [fc] = await Promise.all([a.p.waitForEvent('filechooser'), a.p.tap('[data-act="restore"]')]); await fc.setFiles(f); };
    for (const [n, c] of [['a.txt', 'hello'], ['b.txt', '{"app":"other","data":{}}'], ['c.txt', '{"app":"daftar-mahal","data":null}'], ['d.txt', '{"app":"daftar-mahal","data":{"rentals":5}}'], ['e.txt', '']]) {
      await a.clearToast();
      await feed(put(n, c));
      eq(await a.toast(), T.restore_bad, `refused ${n}`);
    }
    eq(await a.js(() => db.rentals.length), 6, 'data untouched');
    // restore: cancel keeps data, confirm replaces it
    await a.js(() => { db.rentals = []; db.ledger = []; commit(); });
    await feed(put('good.txt', text));
    await a.dialogOpen();
    has(await a.text(DIALOG), 'السبت، 7 تشرين الثاني 2026', 'dialog shows the backup date');
    await a.p.tap(`${DIALOG} .dialog-actions [data-no]`);
    await a.p.waitForTimeout(350);
    eq(await a.js(() => db.rentals.length), 0, 'cancel keeps current data');
    await a.clearToast();
    await feed(put('good2.txt', text));
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    eq(await a.toast(), T.restore_done, 'restore finished');
    await a.p.waitForFunction(() => db.rentals.length === 6);
    const same = await a.js((orig) => { const o = JSON.parse(orig).data; return ['equipment', 'customers', 'rentals', 'repairs', 'ledger'].every((k) => JSON.stringify(db[k]) === JSON.stringify(o[k])); }, text);
    ok(same, 'restored data identical to the backup');
    eq(await a.js((n) => [db.log.length - n, db.log[db.log.length - 1].k], JSON.parse(text).data.log.length), [1, 'restore'], 'the log comes back too, plus the restore itself');
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => balances().get('c2')), 70000, 'restore survives restart');
    // wipe needs two confirmations
    await a.page('settings');
    await a.p.tap('[data-act="wipe"]');
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.p.waitForTimeout(350);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} .dialog-actions [data-no]`);
    await a.p.waitForTimeout(350);
    eq(await a.js(() => db.rentals.length), 6, 'second no keeps data');
    await a.p.tap('[data-act="wipe"]');
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.p.waitForTimeout(350);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.closed();
    await a.p.waitForFunction(() => location.hash === '#/home');
    eq(await a.js(() => [db.rentals.length, db.customers.length, db.equipment.length, db.settings.shopName, db.settings.lang]), [0, 0, 0, 'هريم', 'ar'], 'wiped, keeps language and name');
    eq(await a.js(() => db.log.map((e) => e.k)), ['wipe'], 'only the wipe itself stays in the log');
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => db.rentals.length), 0, 'stays wiped');
    await a.done();
    // moving to a new phone: restore straight from the welcome screen
    const b = await phone();
    await b.open();
    await b.p.waitForSelector('#welcome-form');
    const [fc] = await Promise.all([b.p.waitForEvent('filechooser'), b.p.tap('#w-restore')]);
    await fc.setFiles(put('newphone.txt', text));
    await b.p.waitForSelector('.nav a');
    eq(await b.js(() => [db.rentals.length, balances().get('c1'), db.settings.lang]), [6, 40000, 'ar'], 'new phone restored');
    await b.p.reload();
    await b.p.waitForSelector('.nav a');
    eq(await b.js(() => db.rentals.length), 6, 'still there after restart');
    await b.done();
    // forgotten PIN: the picker opens from the tap, restore removes the lock
    const c = await phone();
    await c.start();
    await c.js(async () => { const salt = 'x'; setPin({ salt, hash: await hashPin('1111', salt) }); });
    await c.p.reload();
    await c.p.waitForSelector('.lock');
    await c.p.tap('#pin-forgot');
    await c.dialogOpen();
    const [fc2] = await Promise.all([c.p.waitForEvent('filechooser'), c.p.tap(`${DIALOG} [data-yes]`)]);
    await fc2.setFiles(put('forgot.txt', text));
    await c.p.waitForSelector('.nav a');
    await c.p.waitForFunction(() => !document.querySelector('.lock'));
    eq(await c.js(() => [getPin(), db.rentals.length]), [null, 6], 'lock removed, data restored');
    await c.done();
  });

  await test('taps: double taps never duplicate or navigate away', async () => {
    const a = await phone();
    await a.start();
    await a.page('equipment');
    await a.fab();
    await a.set('name', 'X'); await a.set('rate', 1000);
    await a.js(() => { const s = document.querySelector('.ov-sheet [type=submit]'); s.click(); s.click(); setTimeout(() => s.click(), 40); setTimeout(() => s.click(), 120); setTimeout(() => s.click(), 300); });
    await a.p.waitForTimeout(700);
    eq(await a.js(() => [db.equipment.length, location.hash]), [1, '#/equipment'], 'save pressed 5 times = one record, same page');
    // X twice
    await a.fab();
    await a.js(() => { const s = document.querySelector('.ov-sheet .sheet-head [data-close]'); s.click(); s.click(); });
    await a.p.waitForTimeout(500);
    eq(await a.js(() => [location.hash, overlays.length]), ['#/equipment', 0], 'X twice stays on the page');
    // scrim twice
    await a.fab();
    await a.js(() => { const s = document.querySelector('.ov-sheet .scrim'); s.click(); s.click(); });
    await a.p.waitForTimeout(500);
    eq(await a.js(() => [location.hash, overlays.length]), ['#/equipment', 0], 'outside tap twice stays');
    // a real double tap on the floating button can't stack sheets
    const box = await (await a.p.$('.fab')).boundingBox();
    await a.p.touchscreen.tap(box.x + 20, box.y + 20);
    await a.p.touchscreen.tap(box.x + 20, box.y + 20);
    await a.p.waitForTimeout(500);
    ok(await a.js(() => overlays.length <= 1), 'at most one sheet');
    await a.js(() => closeAll());
    await a.closed();
    // return confirmed twice records one return, payment once
    await a.js(() => { db.customers = [{ id: 'c', name: 'س', phone: '' }]; db.rentals = [{ id: 'r', customerId: 'c', items: [{ equipmentId: db.equipment[0].id, name: 'X', qty: 1, rate: 1000 }], start: '2026-11-01', advance: 0, returnDate: null }]; commit(); returnForm('r'); });
    await a.sheetOpen();
    await a.js(() => { const s = document.querySelector('.ov-sheet [type=submit]'); s.click(); s.click(); });
    await a.closed();
    eq(await a.js(() => db.rentals[0].paidAtReturn), 6000, 'return applied once');
    await a.js(() => { ledgerForm('pay', { cid: 'c' }); });
    await a.sheetOpen();
    await a.set('amount', 500);
    await a.js(() => { const s = document.querySelector('.ov-sheet [type=submit]'); s.click(); s.click(); setTimeout(() => s.click(), 60); });
    await a.p.waitForTimeout(500);
    eq(await a.js(() => db.ledger.length), 1, 'payment recorded once');
    await a.done();
  });

  await test('forms: unsaved input is protected, Enter does not save', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.page('equipment');
    // clean form closes silently
    await a.fab();
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.closed();
    await a.fab();
    await a.p.goBack();
    await a.closed();
    eq(await a.js(() => location.hash), '#/equipment', 'back on a clean form just closes it');
    // typed something: X asks
    await a.fab();
    await a.set('name', 'ما أريد فقده');
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.dialogOpen();
    has(await a.text(DIALOG), T.discard_title, 'asks before discarding');
    await a.p.tap(`${DIALOG} .dialog-actions [data-no]`);
    await a.p.waitForTimeout(350);
    eq(await a.val('name'), 'ما أريد فقده', 'text still there');
    // tap outside asks too
    await a.p.touchscreen.tap(200, 20);
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} .dialog-actions [data-no]`);
    await a.p.waitForTimeout(350);
    eq(await a.val('name'), 'ما أريد فقده', 'still there');
    // phone back button asks, and history stays consistent
    await a.p.goBack();
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} .dialog-actions [data-no]`);
    await a.p.waitForTimeout(350);
    eq(await a.val('name'), 'ما أريد فقده', 'still there after back');
    await a.p.goBack();
    await a.dialogOpen();
    await a.p.goBack(); // back again dismisses the question, not the form
    await a.p.waitForTimeout(400);
    eq(await a.val('name'), 'ما أريد فقده', 'second back keeps the form');
    await a.p.goBack();
    await a.dialogOpen();
    await a.p.tap(`${DIALOG} [data-yes]`);
    await a.closed();
    eq(await a.js(() => [location.hash, db.equipment.length, overlays.length]), ['#/equipment', 0, 0], 'discarded, still on the page');
    await a.p.tap('[data-act="back"]');
    await a.p.waitForFunction(() => location.hash === '#/more');
    // Enter walks through the fields instead of saving half a form
    await a.tab('more');
    await a.p.tap('[data-page="equipment"]');
    await a.fab();
    await a.set('name', 'نصف');
    await a.p.focus(`${SHEET} [name=name]`);
    await a.p.keyboard.press('Enter');
    await a.p.waitForTimeout(100);
    eq(await a.js(() => [overlays.length, db.equipment.length, document.activeElement.name]), [1, 0, 'total'], 'Enter moved to the next field');
    await a.js(() => closeAll());
    await a.closed();
    await a.done();
  });

  await test('navigation: back, tabs, sub-pages, scroll position, stuck-free closing', async () => {
    const a = await phone();
    await a.start();
    await a.js(() => {
      db.customers = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: `زبون ${String(i).padStart(2, '0')}`, phone: '', note: '' }));
      commit();
    });
    for (const t of ['rentals', 'repairs', 'debts', 'more', 'home']) {
      await a.tab(t);
      await a.p.waitForFunction((h) => location.hash === h, `#/${t}`);
      eq(await a.js(() => location.hash), `#/${t}`, `tab ${t}`);
      eq(await a.p.getAttribute(`.nav a[data-tab="${t}"]`, 'aria-current'), 'page', `tab ${t} highlighted`);
    }
    // the phone's back button: tab -> home -> out of the app
    await a.tab('debts');
    await a.tab('repairs');
    await a.p.goBack();
    await a.p.waitForFunction(() => location.hash === '#/home');
    eq(await a.js(() => [history.state.i, route.name, document.querySelector('.nav a[aria-current]').dataset.tab]), [0, 'home', 'home'], 'back from a tab lands on home');
    await a.tab('rentals');
    await a.tab('home');
    await a.p.waitForFunction(() => location.hash === '#/home');
    eq(await a.js(() => [history.state.i, history.length]), [0, await a.js(() => history.length)], 'tapping home goes back down the history');
    // from a sub-page: bottom tab, then home, then nothing left above home
    await a.page('reports');
    await a.tab('debts');
    await a.tab('home');
    await a.p.waitForFunction(() => location.hash === '#/home' && route.name === 'home');
    eq(await a.js(() => history.state.i), 0, 'home is the bottom entry again');
    // sub-page back arrow and phone back
    await a.page('customers');
    eq(await a.p.getAttribute('.nav a[data-tab="more"]', 'aria-current'), 'page', 'parent stays highlighted');
    await a.js(() => window.scrollTo(0, 900));
    await a.p.waitForTimeout(100);
    await a.p.tap('#list .rc:has-text("زبون 15") .rc-hit');
    await a.p.waitForFunction(() => location.hash.startsWith('#/customer/'));
    eq(await a.js(() => window.scrollY), 0, 'new page starts at the top');
    await a.p.goBack();
    await a.p.waitForFunction(() => location.hash === '#/customers');
    await a.p.waitForTimeout(150);
    const y = await a.js(() => window.scrollY);
    ok(y > 500, `list keeps its scroll position (y=${y})`);
    await a.p.tap('[data-act="back"]');
    await a.p.waitForFunction(() => location.hash === '#/more');
    // opening a customer directly (no history) still has a way back
    await a.p.goto(`${a.base}#/customer/c3`);
    await a.p.waitForSelector('.tb-title h1');
    await a.js(() => history.replaceState({ d: 0 }, '', location.href));
    await a.p.tap('[data-act="back"]');
    await a.p.waitForFunction(() => location.hash === '#/debts');
    // unknown routes and deleted records fall back to home
    await a.p.goto(`${a.base}#/nothing`);
    await a.p.reload();
    await a.p.waitForFunction(() => location.hash === '#/home');
    await a.p.goto(`${a.base}#/customer/deleted`);
    await a.p.reload();
    await a.p.waitForFunction(() => location.hash === '#/home');
    // the customer link in a detail sheet: no duplicate history on the same customer
    await a.js(() => {
      db.rentals = [{ id: 'r', customerId: 'c1', items: [{ equipmentId: 'e', name: 'م', qty: 1, rate: 1000 }], start: '2026-11-01', advance: 0, returnDate: null }];
      commit();
      goPage('customer', 'c1');
      rentalDetail('r');
    });
    await a.sheetOpen();
    const before = await a.js(() => history.length);
    await a.p.tap(`${SHEET} [data-go-customer]`);
    await a.closed();
    eq(await a.js(() => location.hash), '#/customer/c1', 'stays on the customer');
    ok((await a.js(() => history.length)) <= before, 'no extra history entry');
    // if history refuses to move, a sheet still closes instead of getting stuck
    await a.js(() => { rentalDetail('r'); });
    await a.sheetOpen();
    await a.js(() => { window.__back = history.back; history.back = () => {}; });
    await a.p.tap(`${SHEET} .sheet-head [data-close]`);
    await a.p.waitForFunction(() => !overlays.length, null, { timeout: 2000 });
    await a.js(() => { history.back = window.__back; });
    await a.done();
  });

  await test('keyboard: bottom bar hides while typing, iPhone sheet fits above it', async () => {
    const a = await phone({ viewport: { width: 412, height: 839 } });
    await a.start();
    await a.js(() => { db.customers = [{ id: 'c', name: 'س', phone: '' }]; commit(); });
    await a.page('customers');
    eq(await a.p.isVisible('.nav'), true, 'bar visible');
    eq(await a.p.isVisible('.fab'), true, 'add button visible');
    await a.p.setViewportSize({ width: 412, height: 480 }); // split-screen: nothing is being typed
    await a.p.waitForTimeout(100);
    eq(await a.p.isVisible('.nav'), true, 'bar stays in split-screen');
    await a.p.setViewportSize({ width: 412, height: 839 });
    await a.p.waitForTimeout(100);
    await a.p.tap('[data-search="customers"]');
    await a.p.setViewportSize({ width: 412, height: 480 }); // what Android's keyboard does to the layout
    await a.p.waitForTimeout(100);
    if (await a.js(() => navigator.maxTouchPoints > 0)) {
      eq(await a.p.isVisible('.nav'), false, 'bar hidden with keyboard');
      eq(await a.p.isVisible('.fab'), false, 'add button hidden with keyboard');
    }
    await a.p.setViewportSize({ width: 412, height: 839 });
    await a.p.waitForTimeout(100);
    eq(await a.p.isVisible('.nav'), true, 'bar back when the keyboard closes, even with the field still focused');
    await a.js(() => document.activeElement.blur());
    // sheet under an Android keyboard: save stays reachable
    await a.fab();
    await a.p.setViewportSize({ width: 412, height: 430 });
    await a.p.waitForTimeout(150);
    const r = await a.js(() => { const b = document.querySelector('.ov-sheet [type=submit]').getBoundingClientRect(); const s = document.querySelector('.ov-sheet .sheet').getBoundingClientRect(); return [Math.round(b.bottom) <= innerHeight, Math.round(s.top) >= 0, Math.round(s.bottom)]; });
    eq(r.slice(0, 2), [true, true], 'sheet and save button stay on screen');
    await a.p.setViewportSize({ width: 412, height: 839 });
    // iPhone: the page keeps its height, only the visual viewport shrinks
    await a.js(() => {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: { height: 500, offsetTop: 20, addEventListener() {} } });
      trackViewport();
    });
    await a.p.waitForTimeout(350);
    const v = await a.js(() => { const o = document.querySelector('.ov-sheet').getBoundingClientRect(); const s = document.querySelector('.ov-sheet .sheet').getBoundingClientRect(); return [Math.round(o.top), Math.round(o.height), Math.round(s.bottom), s.top >= 20]; });
    eq(v, [20, 500, 520, true], 'sheet sits in the visible part');
    await a.js(() => closeAll());
    await a.closed();
    await a.done();
  });

  await test('storage: stale window, dead connection, broken IndexedDB, restart', async () => {
    // a second window (browser tab next to the installed app) must never erase newer data
    const a = await phone();
    await a.start();
    const T = await a.T();
    const second = await a.ctx.newPage();
    const s = new App(second, a.ctx, a.base);
    await s.open();
    await s.p.waitForSelector('.nav a');
    // the second window is frozen in the background: it hears nothing
    await s.js(() => { channel.onmessage = null; });
    await a.js(() => { db.equipment.push({ id: 'e1', name: 'A', total: 1, rate: 5 }); commit(); });
    await a.p.waitForTimeout(150);
    eq(await s.js(() => db.equipment.length), 0, 'second window is stale');
    await s.p.tap('[data-act="toggle-lang"]'); // it now tries to save its old copy
    await s.p.waitForFunction(() => db.equipment.length === 1);
    await s.p.waitForTimeout(150);
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => db.equipment.length), 1, 'newer data survived the stale save');
    // coming back into view refreshes a stale window without any write
    await s.p.reload();
    await s.p.waitForSelector('.nav a');
    await s.js(() => { channel.onmessage = null; });
    await a.js(() => { db.equipment.push({ id: 'e2', name: 'B', total: 1, rate: 5 }); commit(); });
    await a.p.waitForTimeout(150);
    await s.js(() => document.dispatchEvent(new Event('visibilitychange')));
    await s.p.waitForFunction(() => db.equipment.length === 2);
    // and a live window hears the other one straight away
    await s.js(() => { channel.onmessage = () => syncFromStore(); });
    await a.js(() => { db.equipment.push({ id: 'e3', name: 'C', total: 1, rate: 5 }); commit(); });
    await s.p.waitForFunction(() => db.equipment.length === 3);
    await s.p.close();
    // the phone closes the database connection while the app sleeps
    await a.js(async () => { (await idbConn).close(); });
    await a.js(() => { db.equipment.push({ id: 'e4', name: 'D', total: 1, rate: 5 }); commit(); });
    await a.p.waitForTimeout(200);
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => db.equipment.length), 4, 'save works after a dropped connection');
    eq(await a.js(() => localStorage.getItem('daftar-mahal.db')), null, 'no leftover fallback copy');
    // writes in a burst all land, in order
    await a.js(() => { for (let i = 0; i < 20; i++) { db.equipment.push({ id: `b${i}`, name: `B${i}`, total: 1, rate: 1 }); commit(); } });
    await a.p.waitForTimeout(300);
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => db.equipment.length), 24, 'burst of saves');
    eq(T.app_name, 'هريم', 'name');
    await a.done();

    // IndexedDB completely unavailable: the app still works from localStorage
    const b = await phone();
    await b.ctx.addInitScript(() => { const open = () => { throw new Error('blocked'); }; try { Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => ({ open }) }); } catch (e) { /* ignore */ } });
    await b.start();
    await b.js(() => { db.equipment.push({ id: 'e1', name: 'A', total: 1, rate: 5 }); commit(); });
    await b.p.waitForTimeout(150);
    await b.p.reload();
    await b.p.waitForSelector('.nav a');
    eq(await b.js(() => db.equipment.length), 1, 'data kept without IndexedDB');
    b.problems.length = 0;
    await b.done();

    // a real restart of the browser keeps everything
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hareem-profile-'));
    const open = () => chromium.launchPersistentContext(dir, { ...devices['Pixel 7'], locale: 'ar-IQ' });
    let ctx = await open();
    let p = ctx.pages()[0] || await ctx.newPage();
    await p.goto(BASE);
    await p.tap('#welcome-form [type=submit]');
    await p.waitForSelector('.nav a');
    await p.evaluate(() => { db.customers.push({ id: 'c1', name: 'دائم', phone: '' }); db.ledger.push({ id: 'l', customerId: 'c1', type: 'debt', amount: 777, date: today() }); commit(); });
    await p.waitForTimeout(200);
    await ctx.close();
    ctx = await open();
    p = ctx.pages()[0] || await ctx.newPage();
    await p.goto(BASE);
    await p.waitForSelector('.nav a');
    eq(await p.evaluate(() => balances().get('c1')), 777, 'data after a real browser restart');
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('long lists: 8000 rentals stay fast on a slow phone, show-more works', async () => {
    const a = await phone();
    await a.start();
    await a.js(() => {
      db.equipment = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, name: `معدة ${i}`, total: 100000, rate: 1000 + i }));
      db.customers = Array.from({ length: 1500 }, (_, i) => ({ id: `c${i}`, name: `زبون رقم ${i}`, phone: `0770${String(i).padStart(7, '0')}`, note: '' }));
      const pad2 = (n) => String(n).padStart(2, '0');
      const date = (i) => `${2024 + (i % 3)}-${pad2((i % 12) + 1)}-${pad2((i % 27) + 1)}`;
      db.rentals = Array.from({ length: 8000 }, (_, i) => ({ id: `r${i}`, customerId: `c${i % 1500}`, items: [{ equipmentId: `e${i % 60}`, name: `معدة ${i % 60}`, qty: 1 + (i % 5), rate: 1000 }], start: date(i), advance: 0, note: '', returnDate: i < 40 ? null : date(i), days: 3, total: 3000, paidAtReturn: 2000, createdAt: i, updatedAt: i }));
      db.repairs = Array.from({ length: 4000 }, (_, i) => ({ id: `p${i}`, customerId: `c${i % 1500}`, device: `آلة ${i}`, problem: '', dateIn: date(i), dateOut: date(i), price: 5000, parts: 1000, paid: 4000, status: 'delivered', note: '', createdAt: i, updatedAt: i }));
      db.ledger = Array.from({ length: 3000 }, (_, i) => ({ id: `l${i}`, customerId: `c${i % 1500}`, type: i % 2 ? 'pay' : 'debt', amount: 500, date: date(i), note: '', createdAt: i }));
      const kinds = ['rent', 'return', 'pay', 'debt', 'repair', 'deliver'];
      db.log = Array.from({ length: LOG_MAX }, (_, i) => ({ at: Date.parse('2024-01-01T08:00:00+03:00') + i * 3600e3, k: kinds[i % 6], r: `${'rrllpp'[i % 6]}${i % 3000}`, c: `c${i % 1500}`, cn: `زبون رقم ${i % 1500}`, ...(i % 6 < 2 ? { i: [[`معدة ${i % 60}`, 1 + (i % 5)]] } : { x: `آلة ${i}` }), a: 500 * (i % 40) }));
      commit();
    });
    await a.p.waitForTimeout(800);
    const cdp = await a.ctx.newCDPSession(a.p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const timed = (fn) => a.js(async (src) => { const t0 = performance.now(); (0, eval)(src); document.body.getBoundingClientRect(); return Math.round(performance.now() - t0); }, fn);
    const times = {};
    times.home = await timed("goTab('home')");
    times.rentalsOpen = await timed("goTab('rentals')");
    times.rentalsClosed = await timed("ui.seg.rentals='closed'; render()");
    times.repairsDelivered = await timed("ui.seg.repairs='delivered'; goTab('repairs')");
    times.debts = await timed("goTab('debts')");
    times.customers = await timed("goPage('customers')");
    times.equipment = await timed("goPage('equipment')");
    times.reports = await timed("goPage('reports')");
    times.customerPage = await timed("goPage('customer','c7')");
    times.activity = await timed("goPage('activity')");
    times.activitySearch = await timed("ui.q.activity='زبون رقم 77'; document.querySelector('#list').innerHTML = listActivity(); ui.q.activity=''");
    times.search = await timed("goTab('rentals'); ui.q.rentals='زبون رقم 77'; document.querySelector('#list').innerHTML = listRentals(); ui.q.rentals=''");
    times.saveMs = await a.js(async () => { const t0 = performance.now(); db.settings.lastBackup = null; await writeDb(); return Math.round(performance.now() - t0); });
    console.log(`        times on a 4x slower CPU (ms): ${J(times)}`);
    const size = await a.js(() => JSON.stringify(db).length);
    console.log(`        data size: ${(size / 1024 / 1024).toFixed(2)} MB`);
    for (const [k, v] of Object.entries(times)) ok(v < 1500, `${k} too slow: ${v}ms`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // paging
    await a.js(() => { goTab('rentals'); ui.seg.rentals = 'closed'; render(); });
    eq(await a.p.$$eval('#list .rc', (x) => x.length), 50, 'first 50');
    has(await a.text('#list [data-act="more"]'), String(7960 - 50), 'how many remain');
    await a.p.tap('#list [data-act="more"]');
    await a.p.waitForTimeout(100);
    eq(await a.p.$$eval('#list .rc', (x) => x.length), 100, 'next 50');
    await a.done();
  });

  await test('fresh-install screens: every empty state reads properly', async () => {
    const a = await phone();
    await a.start();
    const T = await a.T();
    await a.tab('rentals');
    has(await a.text('#list'), T.need_equipment, 'rentals says add equipment first');
    await a.p.tap('#list [data-page="equipment"]');
    await a.p.waitForFunction(() => location.hash === '#/equipment');
    await a.p.tap('[data-act="back"]');
    await a.p.waitForFunction(() => location.hash === '#/rentals');
    await a.p.tap('.fab');
    await a.p.waitForFunction(() => location.hash === '#/equipment');
    eq(await a.toast(), T.need_equipment, 'new rental without equipment leads to equipment');
    await a.tab('repairs');
    has(await a.text('#list'), T.no_repairs, 'repairs empty');
    await a.tab('debts');
    has(await a.text('#list'), T.no_debts_title, 'debts empty');
    await a.page('customers');
    has(await a.text('#list'), T.no_customers, 'customers empty');
    await a.page('reports');
    has(await a.text('#view'), T.no_data, 'reports empty');
    has(await a.text('.big-stat .v'), '0', 'zero');
    await a.done();
  });

  await test('offline: full work with no internet, cold start, nothing external', async () => {
    const a = await phone();
    await a.start('ar', '?sw=1');
    await a.js(() => navigator.serviceWorker.ready);
    await a.p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 5000 }).catch(() => {});
    await a.p.waitForTimeout(500);
    const cached = await a.js(async () => { const names = await caches.keys(); const c = await caches.open(names[0]); return { names, files: (await c.keys()).map((r) => new URL(r.url).pathname).sort() }; });
    eq(cached.names, [`hareem-app-${APP_VERSION}`], 'one cache');
    for (const f of ['/', '/css/app.css', '/js/app.js', '/js/i18n.js', '/fonts/vazirmatn-arabic.woff2', '/fonts/vazirmatn-latin.woff2', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) ok(cached.files.includes(f), `cached ${f}`);
    await a.ctx.setOffline(true);
    let reachable = true;
    try { await a.js(() => fetch(`/nope-${Date.now()}.txt`)); } catch (e) { reachable = false; }
    eq(reachable, false, 'really offline');
    a.problems.length = 0;
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    const font = await a.js(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family); });
    ok(font.includes('Vazirmatn'), 'font loaded offline');
    // full job with no internet
    await a.page('equipment');
    await a.addEquipment('خلاطة', 2, 10000);
    await a.tab('rentals');
    await a.fab();
    await a.newCustomer('زبون بلا إنترنت');
    await a.pickEquipment(0, 'خلاطة');
    await a.save();
    await a.p.tap('#list [data-act="return"]');
    await a.sheetOpen();
    await a.set('paid', 4000);
    await a.save();
    eq(await a.js(() => [...balances().values()]), [6000], 'calculated offline');
    // cold start offline, from the installed icon's address
    await a.p.close();
    const p2 = await a.ctx.newPage();
    const a2 = new App(p2, a.ctx, a.base);
    await p2.goto(`${a.base}#/home`);
    await p2.waitForSelector('.nav a');
    eq(await a2.text('.hero-value'), '6,000 د.ع', 'cold start offline shows the data');
    eq(a2.problems, [], 'no failed requests offline');
    await a.ctx.setOffline(false);
    await a.ctx.close();
  });

  await test('update: a new version installs, old cache goes, data stays', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hareem-site-'));
    fs.cpSync(APP_DIR, dir, { recursive: true });
    const site = await serve(dir);
    const a = await phone({ base: site.url });
    await a.start('ar', '?sw=1');
    await a.js(() => navigator.serviceWorker.ready);
    await a.p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 5000 }).catch(() => {});
    await a.p.waitForTimeout(400);
    await a.js(() => { db.customers.push({ id: 'keep', name: 'باقٍ', phone: '' }); commit(); });
    await a.p.waitForTimeout(150);
    // publish a new version
    const swFile = path.join(dir, 'sw.js');
    fs.writeFileSync(swFile, fs.readFileSync(swFile, 'utf8').replace(`const VERSION = '${APP_VERSION}'`, "const VERSION = '9.9.9'"));
    const appFile = path.join(dir, 'js/app.js');
    fs.writeFileSync(appFile, fs.readFileSync(appFile, 'utf8').replace(`const VERSION = '${APP_VERSION}'`, "const VERSION = '9.9.9'"));
    // first open after publishing: still the old files, new ones download in the background
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    await a.js(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    for (let i = 0; i < 80; i++) {
      const keys = await a.js(() => caches.keys());
      if (keys.length === 1 && keys[0] === 'hareem-app-9.9.9') break;
      await a.p.waitForTimeout(100);
    }
    eq(await a.js(() => caches.keys()), ['hareem-app-9.9.9'], 'new files cached, old cache removed');
    // next open: the new version
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => VERSION), '9.9.9', 'new version running');
    eq(await a.js(() => db.customers.map((c) => c.id)), ['keep'], 'data intact after the update');
    await a.ctx.setOffline(true);
    await a.p.reload();
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => VERSION), '9.9.9', 'new version works offline');
    await a.ctx.setOffline(false);
    await a.ctx.close();
    site.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('install: Chrome reports the app as installable', async () => {
    const a = await phone();
    await a.start('ar', '?sw=1');
    await a.js(() => navigator.serviceWorker.ready);
    await a.p.waitForTimeout(400);
    const cdp = await a.ctx.newCDPSession(a.p);
    const man = await cdp.send('Page.getAppManifest');
    eq(man.errors, [], 'manifest has no errors');
    ok(man.url.endsWith('manifest.webmanifest'), 'manifest found');
    const inst = await cdp.send('Page.getInstallabilityErrors');
    eq(inst.installabilityErrors, [], 'no installability errors');
    const parsed = JSON.parse(man.data);
    eq(parsed.name, 'هريم', 'name on the icon');
    eq(await a.js(() => VERSION), APP_VERSION, 'app and offline worker have the same version');
    const head = await a.js(() => ({
      apple: document.querySelector('link[rel=apple-touch-icon]').href.split('/').pop(),
      appleTitle: document.querySelector('meta[name=apple-mobile-web-app-title]').content,
      capable: document.querySelector('meta[name=apple-mobile-web-app-capable]').content,
      vp: document.querySelector('meta[name=viewport]').content,
      translate: document.documentElement.getAttribute('translate'),
      csp: !!document.querySelector('meta[http-equiv=Content-Security-Policy]'),
    }));
    eq([head.apple, head.appleTitle, head.capable, head.translate, head.csp], ['apple-touch-icon.png', 'هريم', 'yes', 'no', true], 'iPhone tags, no auto-translate, strict policy');
    has(head.vp, 'viewport-fit=cover', 'notch support');
    await a.done();
  });

  await test('production: real hostname, /hareem/ sub-path, host-style caching', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hareem-prod-'));
    fs.cpSync(APP_DIR, dir, { recursive: true });
    const site = await serve(dir, { prefix: '/hareem/', cache: 'max-age=600', tls: selfSignedCert() });
    const port = new URL(site.url).port;
    const base = `https://hareem.test:${port}/hareem/`;
    const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP hareem.test 127.0.0.1', '--ignore-certificate-errors'] });
    const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'ar-IQ', timezoneId: 'Asia/Baghdad', ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    const a = new App(page, ctx, base);
    const missing = [];
    const listen = (pg) => pg.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
    listen(page);
    await a.open();
    await page.waitForSelector('#welcome-form');
    eq(await a.js(() => [isSecureContext, !!crypto.subtle, !!crypto.randomUUID]), [true, true, true], 'secure context like https');
    // here the service worker registers by itself, no ?sw needed, already on the welcome screen
    await a.js(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 8000 });
    // internet lost right after installing, before "Start" was ever tapped: the app must still open
    await ctx.setOffline(true);
    a.problems.length = 0;
    await page.reload();
    await page.waitForSelector('#welcome-form');
    eq(a.problems, [], 'welcome opens with no internet');
    await ctx.setOffline(false);
    await page.tap('#welcome-form [type=submit]');
    await page.waitForSelector('.nav a');
    const reg = await a.js(async () => { const r = await navigator.serviceWorker.getRegistration(); const c = await caches.open((await caches.keys())[0]); return { scope: new URL(r.scope).pathname, files: (await c.keys()).map((k) => new URL(k.url).pathname).sort() }; });
    eq(reg.scope, '/hareem/', 'worker scope');
    ok(reg.files.every((f) => f.startsWith('/hareem/')) && reg.files.length === 13, `all 13 files cached under the sub-path: ${J(reg.files)}`);
    // installable, and the manifest points at this sub-path
    const cdp = await ctx.newCDPSession(page);
    const man = await cdp.send('Page.getAppManifest');
    eq([man.errors, (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors], [[], []], 'installable');
    const resolved = await a.js(async () => { const m = await (await fetch('manifest.webmanifest')).json(); return { start: new URL(m.start_url, new URL('manifest.webmanifest', location.href)).href, scope: new URL(m.scope, new URL('manifest.webmanifest', location.href)).href }; });
    eq(resolved, { start: `${base}#/home`, scope: base }, 'icon opens the right address');
    // a day of work, online then with no internet, then a cold start from the icon
    await a.page('equipment');
    await a.addEquipment('خلاطة', 2, 10000);
    await ctx.setOffline(true);
    a.problems.length = 0;
    await page.reload();
    await page.waitForSelector('.nav a');
    await a.tab('debts');
    await page.tap('[data-act="new-debt"]');
    await a.sheetOpen();
    await a.newCustomer('زبون');
    await a.set('amount', 5000);
    await a.save();
    await page.close();
    const p2 = await ctx.newPage();
    const a2 = new App(p2, ctx, base);
    listen(p2);
    await p2.goto(`${base}#/home`);
    await p2.waitForSelector('.nav a');
    has(await a2.text('.hero-value'), '5,000', 'cold start with no internet shows the data');
    ok(await a2.js(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.status === 'loaded'); }), 'font loaded');
    eq(a2.problems, [], 'nothing failed offline');
    await ctx.setOffline(false);
    // a release while the host caches files for 10 minutes: the phone must still get the new files
    for (const f of ['sw.js', 'js/app.js']) {
      const fp = path.join(dir, f);
      fs.writeFileSync(fp, fs.readFileSync(fp, 'utf8').replace(`const VERSION = '${APP_VERSION}'`, "const VERSION = '9.9.9'"));
    }
    await p2.reload();
    await p2.waitForSelector('.nav a');
    await a2.js(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    for (let i = 0; i < 80; i++) {
      const keys = await a2.js(() => caches.keys());
      if (keys.length === 1 && keys[0] === 'hareem-app-9.9.9') break;
      await p2.waitForTimeout(100);
    }
    await p2.reload();
    await p2.waitForSelector('.nav a');
    eq(await a2.js(() => [VERSION, [...balances().values()]]), ['9.9.9', [5000]], 'new version, same data');
    eq(missing, [], 'no missing files');
    await ctx.close();
    await browser.close();
    site.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /* the same real job on other engines and screen sizes */
  const coreJob = async (a, lang = 'ar') => {
    await a.start(lang);
    const T = await a.T(lang);
    await a.page('equipment');
    await a.addEquipment('خلاطة', 2, 10000);
    await a.tab('rentals');
    await a.fab();
    await a.newCustomer('زبون التجربة', '0770');
    await a.pickEquipment(0, 'خلاطة', 2);
    await a.set('start', '2026-11-04');
    await a.set('advance', 5000);
    await a.save();
    has(await a.text('#list .rc'), `60,000 ${T.currency}`, '3 days × 2 × 10,000');
    await a.p.tap('#list [data-act="return"]');
    await a.sheetOpen();
    eq([await a.val('days'), await a.val('total'), await a.val('paid')], ['3', '60,000', '55,000'], 'return defaults');
    await a.set('paid', 25000);
    await a.save();
    await a.tab('repairs');
    await a.fab();
    await a.pickCustomer('زبون', 'زبون التجربة');
    eq(await a.p.isVisible(`${SHEET} .combo-new`), false, 'existing customer: no new-customer field');
    await a.set('device', 'دريل');
    await a.save();
    eq(await a.js(() => db.customers.length), 1, 'picking from the list creates no second customer');
    // the "new customer" row works by touch too
    await a.fab();
    await a.set('customerName', 'زبون آخر');
    await a.p.tap(`${SHEET} .combo-add`);
    await a.p.waitForTimeout(350);
    eq(await a.js(() => [document.activeElement.name, document.querySelector('.ov-sheet:not(.closing) .combo-new').hidden]), ['customerPhone', false], 'moves to the phone field');
    await a.js(() => closeAll());
    await a.closed();
    await a.p.tap('#list [data-act="ready"]');
    await a.p.tap('[data-act="seg"][data-val="ready"]');
    await a.p.tap('#list [data-act="deliver"]');
    await a.sheetOpen();
    await a.set('price', 20000);
    await a.set('parts', 5000);
    await a.set('paid', 10000);
    await a.save();
    await a.tab('debts');
    eq(await a.text('.hero-value'), `40,000 ${T.currency}`, '30,000 + 10,000');
    await a.p.tap('#list .rc-hit');
    await a.p.tap('.profile [data-act="new-payment"]');
    await a.sheetOpen();
    await a.set('amount', 15000);
    await a.save();
    eq(await a.text('.balance'), `${T.owes} 25,000 ${T.currency}`, 'after payment');
    await a.page('reports');
    eq(await a.text('.big-stat .v'), `75,000 ${T.currency}`, '60,000 + 15,000 profit');
    await a.p.goBack();
    await a.page('settings');
    await a.p.tap('[data-act="pin-on"]');
    await a.sheetOpen();
    for (const k of '12341234') { await a.p.tap(`${SHEET} [data-key="${k}"]`); if (k === '4') await a.p.waitForTimeout(220); }
    await a.closed();
    await a.p.reload();
    await a.p.waitForSelector('.lock');
    for (const k of '1234') await a.p.tap(`.lock [data-key="${k}"]`);
    await a.p.waitForSelector('.nav a');
    eq(await a.js(() => [...balances().values()]), [25000], 'data after reopening');
  };
  await test('core job: iPhone (WebKit engine)', async () => { const a = await phone({ engine: 'webkit', device: 'iPhone 14' }); await coreJob(a); await a.done(); });
  await test('core job: iPhone in Kurdish (WebKit engine)', async () => { const a = await phone({ engine: 'webkit', device: 'iPhone SE', colorScheme: 'dark' }); await coreJob(a, 'ku'); await a.done(); });
  await test('core job: small Android 360x640 in Kurdish, dark', async () => { const a = await phone({ device: 'Galaxy S5', colorScheme: 'dark' }); await coreJob(a, 'ku'); await a.done(); });
  await test('core job: very small phone 320x568', async () => { const a = await phone({ viewport: { width: 320, height: 568 } }); await coreJob(a); await a.done(); });
  await test('core job: Samsung-size 412x915 in Kurdish', async () => { const a = await phone({ viewport: { width: 412, height: 915 } }); await coreJob(a, 'ku'); await a.done(); });
}

/* ---------- audit of every screen ---------- */
const RICH = {
  long: 'عبدالرحمن محمد حسين الجبوري البغدادي صاحب مقاولات النور',
  kurd: 'کاک ئازاد ڕەشید',
  eq1: 'خلاطة كونكريت كبيرة مع محرك ديزل خمسة حصان',
  prob: 'الفحمات خلصانة والسويج عاطل والمحرك يسخن بسرعة بعد خمس دقائق من التشغيل المتواصل',
  note: 'يرجع المعدات بعد انتهاء الصب، موقع العمل في الكرادة خلف السوق',
};
function seedRich(R) {
  const e = (id, name, total, rate) => ({ id, name, total, rate, note: '' });
  const pic = (color) => { const k = document.createElement('canvas'); k.width = 320; k.height = 240; const g = k.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.fillRect(100, 70, 120, 100); return k.toDataURL('image/jpeg', 0.7); };
  db.equipment = [e('e1', R.eq1, 5, 125000), e('e2', 'سقالة حديد', 400, 1500), e('e3', 'مولدة 5 كيلو', 2, 35000), e('e4', 'هلتي تكسير', 3, 20000), e('e5', '', 4, 0)];
  db.equipment[1].photo = pic('#c0392b');
  db.equipment[3].photo = pic('#2471a3');
  db.equipment[4].photo = pic('#27ae60');
  db.customers = [{ id: 'c1', name: R.long, phone: '0770 123 4567', note: R.note }, { id: 'c2', name: R.kurd, phone: '0750 444 1122', note: '' }, { id: 'c3', name: 'علي', phone: '', note: '' }, { id: 'c4', name: 'سامي', phone: '', note: '' }];
  const line = (id, q) => { const x = db.equipment.find((v) => v.id === id); return { equipmentId: id, name: x.name, qty: q, rate: x.rate }; };
  const r = (id, c, items, start, ret, days, total, adv, paid, note = '') => ({ id, customerId: c, items, start, advance: adv, note, returnDate: ret, days, total, paidAtReturn: paid, createdAt: 1, updatedAt: 1 });
  db.rentals = [
    r('r1', 'c1', [line('e1', 3), line('e2', 240), line('e3', 1), line('e4', 2), line('e5', 2)], '2026-09-02', null, null, null, 2500000, null, R.note),
    r('r2', 'c2', [line('e2', 20)], '2026-11-06', null, null, null, 0, null),
    r('r3', 'c1', [line('e1', 2), line('e4', 1)], '2026-08-01', '2026-11-05', 96, 24500000, 2000000, 10000000, R.note),
    r('r4', 'c3', [line('e3', 1)], '2026-10-20', '2026-11-02', 13, 455000, 0, 455000),
  ];
  const p = (id, c, device, problem, dIn, dOut, price, parts, paid, status, note = '') => ({ id, customerId: c, device, problem, dateIn: dIn, dateOut: dOut, price, parts, paid, status, note, createdAt: 1, updatedAt: 1 });
  db.repairs = [
    p('p1', 'c1', 'مولدة كهرباء هوندا عشرة كيلو واط', R.prob, '2026-10-30', null, 0, 0, 0, 'pending', R.note),
    p('p2', 'c2', 'دريل هلتي', 'السويج عاطل', '2026-11-05', null, 450000, 150000, 0, 'ready'),
    p('p3', 'c1', 'خلاطة صغيرة', R.prob, '2026-10-01', '2026-11-03', 3500000, 1250000, 2000000, 'delivered', R.note),
    p('p4', 'c3', 'جلاخة بوش', '', '2026-10-01', '2026-10-15', 80000, 90000, 80000, 'delivered'),
  ];
  db.ledger = [
    { id: 'l1', customerId: 'c1', type: 'pay', amount: 1500000, date: '2026-11-04', note: R.note, createdAt: 1 },
    { id: 'l2', customerId: 'c2', type: 'debt', amount: 125000000, date: '2026-05-15', note: 'بقية حساب قديم', createdAt: 1 },
    { id: 'l3', customerId: 'c4', type: 'pay', amount: 75000, date: '2026-11-01', note: '', createdAt: 1 },
  ];
  // exact moments: some records were entered on their own day (the time shows), the rest were back-dated
  const at = (x) => Date.parse(`${x}+03:00`);
  Object.assign(db.rentals[1], { createdAt: at('2026-11-06T16:42:10') });
  Object.assign(db.rentals[2], { returnedAt: at('2026-11-05T13:05:00'), editedAt: at('2026-11-06T08:01:30') });
  Object.assign(db.repairs[1], { createdAt: at('2026-11-05T09:15:00'), readyAt: at('2026-11-06T17:20:05') });
  Object.assign(db.repairs[2], { deliveredAt: at('2026-11-03T12:00:59') });
  Object.assign(db.ledger[0], { createdAt: at('2026-11-04T18:30:45') });
  const items = (x) => x.items.map((i) => [i.name, i.qty]);
  const L = (x, k, more = {}) => ({ at: at(x), k, ...more });
  db.log = [
    L('2026-11-03T12:00:59', 'deliver', { r: 'p3', c: 'c1', cn: R.long, x: `خلاطة صغيرة · ${R.prob}`, a: 3500000, p: 2000000 }),
    L('2026-11-04T18:30:45', 'pay', { r: 'l1', t: 'pay', c: 'c1', cn: R.long, n: R.note, a: 1500000 }),
    L('2026-11-05T09:15:00', 'repair', { r: 'p2', c: 'c2', cn: R.kurd, x: 'دريل هلتي · السويج عاطل' }),
    L('2026-11-05T13:05:00', 'return', { r: 'r3', c: 'c1', cn: R.long, i: items(db.rentals[2]), a: 24500000, p: 10000000 }),
    L('2026-11-06T08:01:30', 'rent_edit', { r: 'r3', c: 'c1', cn: R.long, i: items(db.rentals[2]) }),
    L('2026-11-06T16:42:10', 'rent', { r: 'r2', c: 'c2', cn: R.kurd, i: items(db.rentals[1]) }),
    L('2026-11-06T17:20:05', 'ready', { r: 'p2', c: 'c2', cn: R.kurd, x: 'دريل هلتي · السويج عاطل' }),
    L('2026-11-07T00:00:01', 'rent', { r: 'gone', c: 'gone', cn: 'علي', i: [['', 2], ['سقالة حديد', 240]], p: 2500000 }),
    L('2026-11-07T00:10:00', 'rent_del', { c: 'gone', cn: 'علي', i: [['', 2], ['سقالة حديد', 240]] }),
    L('2026-11-07T08:59:59', 'eq_new', { r: 'e5' }),
    L('2026-11-07T09:30:00', 'ledger_del', { t: 'debt', c: 'c4', cn: 'سامي', a: 125000000 }),
    L('2026-11-07T09:45:12', 'cust_del', { c: 'gone2', cn: R.long }),
    L('2026-11-07T09:58:01', 'backup'),
  ];
  commit();
}
// runs in the page: looks at the top-most layer and reports anything a person would call broken
function auditPage() {
  const issues = [];
  const add = (kind, el, extra = '') => {
    const label = (el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : el.tagName.toLowerCase());
    issues.push(`${kind} ${el.tagName.toLowerCase()}${label.startsWith('.') ? label : ''} ${extra}`.trim());
  };
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls sideways ${document.documentElement.scrollWidth}>${vw}`);
  const overs = [...document.querySelectorAll('.ov:not(.closing)')];
  const scr = document.querySelector('#screen .screen');
  const scopes = scr && !overs.some((o) => o.classList.contains('ov-dialog')) ? [scr] : overs.length ? [overs[overs.length - 1]] : [document.querySelector('#app'), document.querySelector('#nav'), document.querySelector('#fab-slot')];
  const parseRGB = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
  const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) { const c = parseRGB(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const ELLIPSIS_OK = /^(SPAN|H1|H2|P|B)$/;
  for (const scope of scopes) {
    if (!scope) continue;
    for (const el of scope.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('svg') || el.closest('.scrim')) continue;
      const inScroller = el.closest('.tbl-wrap');
      if (!inScroller && (r.right > vw + 1 || r.left < -1)) add('off-screen', el, `${Math.round(r.left)}..${Math.round(r.right)}`);
      const clips = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      if (clips && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches('.card, .hero, .menu-card, .stepper, .meter, .rank-bar, .sheet')) {
        if (cs.textOverflow === 'ellipsis' && ELLIPSIS_OK.test(el.tagName)) add('ellipsis', el, (el.innerText || '').slice(0, 20));
        else if (el.matches('input:not([data-money]), textarea')) { /* long text scrolls inside a field */ }
        else add('CLIPPED', el, `${el.scrollWidth}>${el.clientWidth}: ${(el.innerText || '').slice(0, 24)}`);
      }
      if (clips && cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && !el.matches('.card, .hero, .sheet, .sheet-body, .menu-card, .stepper, .rc-sub, .log-sub, .rc-title > span, .ep-name, textarea') && !el.closest('.sheet-body.scroll')) add('v-clipped', el, `${el.scrollHeight}>${el.clientHeight}`);
      // text sticking out of its button, chip, tile or column
      const direct = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (direct.length && cs.textOverflow !== 'ellipsis' && !el.matches('textarea, input, select')) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const t = range.getBoundingClientRect();
        const box = (el.closest('.btn, .chip, .stat, .rc, .col, td, th, .field, .dialog, .seg button, .nav a, .quick button, .menu-item, .line-item, .sum-row, .result, .hero, .kv > div, .rank-top, .legend, .sheet-body') || el).getBoundingClientRect();
        if (!inScroller && (t.left < box.left - 1 || t.right > box.right + 1)) add('text-outside-box', el, `${Math.round(t.left)}..${Math.round(t.right)} in ${Math.round(box.left)}..${Math.round(box.right)}: ${el.textContent.trim().slice(0, 24)}`);
        // contrast
        const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
        const fg = parseRGB(cs.color);
        if (fg) {
          fg.a *= opacityOf(el);
          const bg = bgOf(el);
          const f = blend(fg, bg);
          const L1 = lum(f), L2 = lum(bg);
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
          if (ratio < need) add('low-contrast', el, `${ratio.toFixed(2)}<${need}: ${el.textContent.trim().slice(0, 20)}`);
        }
      }
      if (el.matches('.hero-value, .stat-v, .big-stat .v, .b-value') && el.scrollWidth > el.clientWidth + 1) add('NOT-FITTED', el, `${el.scrollWidth}>${el.clientWidth}: ${el.innerText}`);
      if (el.matches('button:not(.col), a, input:not([type=hidden]), select, textarea, summary') && !el.disabled) {
        if (Math.min(r.width, r.height) < 36) add('small-target', el, `${Math.round(r.width)}x${Math.round(r.height)}: ${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 16)}`);
      }
    }
  }
  const sheet = document.querySelector('.ov-sheet:not(.closing) .sheet');
  if (sheet) { const r = sheet.getBoundingClientRect(); if (r.top < -1 || r.bottom > innerHeight + 1) issues.push(`sheet off screen ${Math.round(r.top)}..${Math.round(r.bottom)}/${innerHeight}`); }
  const text = scopes.filter(Boolean).map((s) => s.innerText).join('\n');
  return { issues: [...new Set(issues)], text };
}
const STATES = [
  ['home', (a) => a.js(() => goTab('home'))],
  ['rentals-open', (a) => a.js(() => { ui.seg.rentals = 'open'; goTab('rentals'); })],
  ['rentals-closed', (a) => a.js(() => { ui.seg.rentals = 'closed'; goTab('rentals'); })],
  ['repairs-pending', (a) => a.js(() => { ui.seg.repairs = 'pending'; goTab('repairs'); })],
  ['repairs-ready', (a) => a.js(() => { ui.seg.repairs = 'ready'; goTab('repairs'); })],
  ['repairs-delivered', (a) => a.js(() => { ui.seg.repairs = 'delivered'; goTab('repairs'); })],
  ['debts', (a) => a.js(() => goTab('debts'))],
  ['more', (a) => a.js(() => goTab('more'))],
  ['equipment', (a) => a.js(() => goPage('equipment'))],
  ['customers', (a) => a.js(() => goPage('customers'))],
  ['customer-long', (a) => a.js(() => goPage('customer', 'c1'))],
  ['customer-credit', (a) => a.js(() => goPage('customer', 'c4'))],
  ['reports', (a) => a.js(() => { ui.seg.period = 'all'; goPage('reports'); })],
  ['reports-table', (a) => a.js(() => { goPage('reports'); document.querySelector('.tbl').open = true; document.querySelector('.tbl').scrollIntoView({ block: 'center' }); })],
  ['reports-numbers', (a) => a.js(() => { goPage('reports'); document.querySelector('.big-stat').scrollIntoView(); window.scrollBy(0, -80); })],
  ['reports-bottom', (a) => a.js(() => { goPage('reports'); window.scrollTo(0, 99999); })],
  ['settings', (a) => a.js(() => goPage('settings'))],
  ['home-activity', (a) => a.js(async () => { goTab('home'); await new Promise((r) => setTimeout(r, 80)); window.scrollTo(0, 99999); })],
  ['activity', (a) => a.js(() => { ui.seg.activity = 'all'; goPage('activity'); })],
  ['activity-bottom', (a) => a.js(() => { ui.seg.activity = 'all'; goPage('activity'); window.scrollTo(0, 99999); })],
  ['activity-money', (a) => a.js(() => { ui.seg.activity = 'money'; goPage('activity'); })],
  ['settings-bottom', (a) => a.js(() => { goPage('settings'); window.scrollTo(0, 99999); })],
  ['rental-new', (a) => a.js(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 80));
    goTab('rentals'); rentalForm();
    const f = document.querySelector('.ov-sheet:not(.closing) form');
    f.elements.customerName.value = 'زبون جديد تماماً'; f.elements.customerName.dispatchEvent(new Event('input', { bubbles: true }));
    f.querySelector('[data-pick-eq]').click(); await wait();
    document.querySelector('.ov-picker:not(.closing) .eq-opt[data-name="سقالة حديد"]').click(); await wait();
    f.querySelector('[data-add-row]').click(); await wait();
    document.querySelector('.ov-picker:not(.closing) .eq-opt[data-name="مولدة 5 كيلو"]').click(); await wait();
    const q = f.querySelectorAll('[data-row]')[0].querySelector('[name=qty]');
    q.value = '999'; q.dispatchEvent(new Event('input', { bubbles: true }));
  })],
  ['eq-picker', (a) => a.js(() => { goTab('rentals'); rentalForm(); document.querySelector('.ov-sheet:not(.closing) [data-pick-eq]').click(); })],
  ['equipment-photo', (a) => a.js(() => { goPage('equipment'); equipmentForm('e2'); })],
  ['equipment-unnamed', (a) => a.js(() => { goPage('equipment'); equipmentForm('e5'); })],
  ['equipment-errors', (a) => a.js(() => { goPage('equipment'); equipmentForm(); document.querySelector('.ov-sheet:not(.closing) form').requestSubmit(); })],
  ['repair-errors', (a) => a.js(() => { goTab('repairs'); repairForm(); document.querySelector('.ov-sheet:not(.closing) form').requestSubmit(); })],
  ['customer-errors', (a) => a.js(() => { goPage('customers'); customerForm(); document.querySelector('.ov-sheet:not(.closing) form').requestSubmit(); })],
  ['rental-errors', (a) => a.js(() => { goTab('rentals'); rentalForm(); document.querySelector('.ov-sheet:not(.closing) form').requestSubmit(); })],
  ['rental-detail-open', (a) => a.js(() => { goTab('rentals'); rentalDetail('r1'); })],
  ['rental-detail-closed', (a) => a.js(() => { goTab('rentals'); rentalDetail('r3'); })],
  ['rental-edit-closed', (a) => a.js(() => { goTab('rentals'); rentalForm('r3'); })],
  ['return', (a) => a.js(() => { goTab('rentals'); returnForm('r1'); const f = document.querySelector('.ov-sheet:not(.closing) form'); f.elements.paid.value = '1,000,000'; f.elements.paid.dispatchEvent(new Event('input', { bubbles: true })); })],
  ['return-partial', (a) => a.js(() => { goTab('rentals'); returnForm('r1'); const f = document.querySelector('.ov-sheet:not(.closing) form'); for (const [n, v] of [['ret1', '100'], ['ret2', '0'], ['paid', '500,000']]) { f.elements[n].value = v; f.elements[n].dispatchEvent(new Event('input', { bubbles: true })); } })],
  ['return-partial-err', (a) => a.js(() => { goTab('rentals'); returnForm('r2'); const f = document.querySelector('.ov-sheet:not(.closing) form'); f.elements.ret0.value = '0'; f.elements.ret0.dispatchEvent(new Event('input', { bubbles: true })); f.requestSubmit(); })],
  ['repair-new', (a) => a.js(() => { goTab('repairs'); repairForm(); })],
  ['repair-detail-pending', (a) => a.js(() => { goTab('repairs'); repairDetail('p1'); })],
  ['repair-detail-delivered', (a) => a.js(() => { goTab('repairs'); repairDetail('p3'); })],
  ['repair-edit-delivered', (a) => a.js(() => { goTab('repairs'); repairForm('p3'); })],
  ['deliver', (a) => a.js(() => { goTab('repairs'); deliverForm('p2'); })],
  ['payment', (a) => a.js(() => { goTab('debts'); ledgerForm('pay', { cid: 'c2' }); const f = document.querySelector('.ov-sheet:not(.closing) form'); f.elements.amount.value = '1,000,000'; f.elements.amount.dispatchEvent(new Event('input', { bubbles: true })); })],
  ['debt-new', (a) => a.js(() => { goTab('debts'); ledgerForm('debt', {}); })],
  ['ledger-edit', (a) => a.js(() => { goPage('customer', 'c1'); ledgerForm(null, { id: 'l1' }); })],
  ['customer-new', (a) => a.js(() => { goPage('customers'); customerForm(); })],
  ['customer-edit', (a) => a.js(() => { goPage('customer', 'c1'); customerForm('c1'); })],
  ['equipment-new', (a) => a.js(() => { goPage('equipment'); equipmentForm(); })],
  ['equipment-edit', (a) => a.js(() => { goPage('equipment'); equipmentForm('e1'); })],
  ['pin-setup', (a) => a.js(() => { goPage('settings'); pinSetupSheet(); })],
  ['dialog-delete', (a) => a.js(() => { goTab('rentals'); rentalDetail('r1'); confirmDelete(); })],
  ['dialog-discard', (a) => a.js(() => { goPage('equipment'); equipmentForm(); const f = document.querySelector('.ov-sheet:not(.closing) form'); f.elements.name.value = 'x'; requestClose(); })],
  ['dialog-wipe', (a) => a.js(() => { goPage('settings'); wipeAll(); })],
  ['dialog-forgot', (a) => a.js(() => { showLock(); document.querySelector('#pin-forgot').click(); })],
  ['lock', (a) => a.js(() => showLock())],
];
const EMPTY_STATES = [
  ['welcome', null],
  ['empty-home', (a) => a.js(() => goTab('home'))],
  ['empty-rentals', (a) => a.js(() => { ui.seg.rentals = 'open'; goTab('rentals'); })],
  ['empty-rentals-closed', (a) => a.js(() => { db.equipment = [{ id: 'e1', name: 'م', total: 1, rate: 1 }]; ui.seg.rentals = 'closed'; goTab('rentals'); })],
  ['empty-repairs', (a) => a.js(() => { ui.seg.repairs = 'pending'; goTab('repairs'); })],
  ['empty-debts', (a) => a.js(() => goTab('debts'))],
  ['empty-customers', (a) => a.js(() => goPage('customers'))],
  ['empty-equipment', (a) => a.js(() => { db.equipment = []; goPage('equipment'); })],
  ['empty-reports', (a) => a.js(() => { db.equipment = []; goPage('reports'); })],
  ['empty-activity', (a) => a.js(() => { db.log = []; goPage('activity'); })],
];
const NO_ANIM = '*,*::before,*::after{transition:none!important;animation:none!important}';
async function auditCombo(width, height, lang, scheme, shoot, engine = 'chromium', device = 'Pixel 7') {
  const a = await phone({ viewport: { width, height }, colorScheme: scheme, engine, device });
  const found = [];
  const dir = path.join(SHOTS, `${engine === 'chromium' ? '' : `${engine}-`}${width}-${lang}-${scheme}`);
  if (shoot) fs.mkdirSync(dir, { recursive: true });
  const inspect = async (name, n) => {
    await a.p.waitForTimeout(90);
    const { issues, text } = await a.js(auditPage);
    for (const i of issues) found.push({ state: name, issue: i });
    let t = text;
    for (const v of [RICH.long, RICH.kurd, RICH.eq1, RICH.prob, RICH.note, 'سقالة حديد', 'مولدة 5 كيلو', 'هلتي تكسير', 'علي', 'سامي', 'مولدة كهرباء هوندا عشرة كيلو واط', 'دريل هلتي', 'السويج عاطل', 'خلاطة صغيرة', 'جلاخة بوش', 'بقية حساب قديم', 'زبون جديد تماماً', 'العربية', 'کوردی', 'هريم', 'سقالة', 'مولدة', 'هلتي', 'أ', 'ك', 'ک', 'ع', 'س', 'خ', 'م']) t = t.split(v).join(' ');
    const wrong = lang === 'ku' ? t.match(/[كيةىأإآ]/g) : t.match(/[کیەێۆڵڕڤ]/g);
    if (wrong) found.push({ state: name, issue: `WRONG-LANGUAGE letters ${[...new Set(wrong)].join(' ')} in: ${t.replace(/\s+/g, ' ').slice(0, 160)}` });
    const bad = t.match(/\b[a-z]+_[a-z_]+\b|undefined|NaN|\bnull\b|Infinity|\{[a-z]+\}|\[object/);
    if (bad) found.push({ state: name, issue: `RAW-TEXT ${bad[0]}` });
    if (shoot) await a.p.screenshot({ path: path.join(dir, `${String(n).padStart(2, '0')}-${name}.png`) });
  };
  // welcome first (real first-run state), then the empty app
  await a.open();
  await a.p.waitForSelector('#welcome-form');
  await a.p.addStyleTag({ content: NO_ANIM });
  if (lang !== 'ar') await a.p.tap(`[data-wl="${lang}"]`);
  let n = 0;
  await inspect('welcome', n++);
  await a.p.tap('#welcome-form [type=submit]');
  await a.p.waitForSelector('.nav a');
  for (const [name, run] of EMPTY_STATES.slice(1)) {
    await run(a);
    await inspect(name, n++);
    await a.js(() => closeAll());
  }
  await a.js(seedRich, RICH);
  await a.p.waitForTimeout(60);
  for (const [name, run] of STATES) {
    await a.js(() => closeAll());
    await a.js(() => { const s = document.querySelector('#screen'); if (s.querySelector('.lock')) { s.innerHTML = ''; locked = false; } });
    await run(a);
    await inspect(name, n++);
  }
  await a.js(() => closeAll());
  a.problems = a.problems.filter((x) => !x.includes('blocked'));
  await a.done();
  return found;
}

async function audits() {
  await test('audit: every screen, sizes, languages, themes', async () => {
    const combos = [[320, 568, 'ku', 'light', true], [320, 568, 'ar', 'dark', false], [360, 740, 'ar', 'light', true], [360, 740, 'ku', 'dark', true], [390, 844, 'ku', 'light', false], [412, 915, 'ar', 'dark', false], [412, 915, 'ku', 'light', false], [390, 664, 'ar', 'light', true, 'webkit', 'iPhone 14'], [320, 568, 'ku', 'dark', false, 'webkit', 'iPhone SE'], [300, 640, 'ku', 'light', false]];
    const all = {};
    for (const [w, h, l, sc, shoot, engine, device] of combos) {
      const found = await auditCombo(w, h, l, sc, shoot, engine, device);
      for (const f of found) { const k = f.issue; (all[k] = all[k] || new Set()).add(`${engine || ''}${w}/${l}/${sc}:${f.state}`); }
    }
    const keys = Object.keys(all).sort();
    const serious = keys.filter((k) => !k.startsWith('ellipsis'));
    fs.writeFileSync(path.join(SHOTS, 'audit.txt'), keys.map((k) => `${k}\n    ${[...all[k]].slice(0, 6).join(' , ')}${all[k].size > 6 ? ` (+${all[k].size - 6})` : ''}`).join('\n'));
    console.log(`        audit: ${keys.length} distinct findings, ${serious.length} not ellipsis; details in ${path.join(SHOTS, 'audit.txt')}`);
    eq(serious.length, 0, 'no layout, contrast or language findings');
  });

  await test('letters: the font draws every character the app uses', async () => {
    const a = await phone();
    await a.open();
    await a.p.waitForSelector('#welcome-form');
    const missing = await a.js(async () => {
      const collect = (o) => Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v : typeof v === 'function' ? [v(1), v(2), v(5), v(12)] : []));
      const chars = [...new Set([...collect(window.I18N.ar), ...collect(window.I18N.ku), '0123456789,×·د.ع'].join(''))].filter((c) => c.trim() && !/[{}]/.test(c));
      await document.fonts.load('400 40px Vazirmatn', chars.join(''));
      await document.fonts.load('800 40px Vazirmatn', chars.join(''));
      const c = document.createElement('canvas').getContext('2d');
      const width = (font, ch) => { c.font = font; return c.measureText(ch).width; };
      return { total: chars.length, missing: chars.filter((ch) => ['Courier New', 'Times New Roman', 'Tahoma'].map((f) => width(`40px "Vazirmatn", "${f}"`, ch).toFixed(2)).some((w, i, l) => w !== l[0])) };
    });
    console.log(`        ${missing.total} different characters checked`);
    eq(missing.missing, [], 'characters missing from the font');
    const ku = await a.js(() => {
      const collect = (o) => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : Array.isArray(v) ? v.map((x) => [k, x]) : typeof v === 'function' ? [[k, v(1)], [k, v(5)], [k, v(12)]] : []));
      return {
        ku: collect(window.I18N.ku).filter(([, s]) => /[كيةىأإآ]/.test(s)),
        ar: collect(window.I18N.ar).filter(([, s]) => /[کیەێۆڵڕڤ]/.test(s)),
        missingKu: Object.keys(window.I18N.ar).filter((k) => !(k in window.I18N.ku)),
        missingAr: Object.keys(window.I18N.ku).filter((k) => !(k in window.I18N.ar)),
      };
    });
    eq(ku, { ku: [], ar: [], missingKu: [], missingAr: [] }, 'each language uses its own letters, nothing untranslated');
    const src = fs.readFileSync(path.join(APP_DIR, 'js/app.js'), 'utf8');
    const used = [...new Set([...src.matchAll(/\bt\('([a-z0-9_]+)'/g)].map((m) => m[1]))];
    const dict = await a.js(() => Object.keys(window.I18N.ar));
    eq(used.filter((k) => !dict.includes(k)), [], 'every text used by the app exists');
    await a.done();
  });
}

/* ======================================================================== */
(async () => {
  const site = await serve(APP_DIR);
  BASE = site.url;
  const t0 = Date.now();
  await suite();
  await audits();
  for (const b of Object.values(browsers)) await b.close();
  site.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} tests passed, ${assertions} checks, ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
