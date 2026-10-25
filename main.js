'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, clipboard, net, session, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { createServer } = require('./server');
const tunnel = require('./tunnel');
const updater = require('./updater');
const signing = require('./signing');
const { createGames } = require('./games');

const IS_MAC = process.platform === 'darwin';
if (process.platform === 'win32') app.setAppUserModelId('com.whudsontosh.monolith');
// Smoke test (the release build checks the packaged app really starts): --monolith-smoke-out=<file>
const SMOKE_OUT = (process.argv.find((a) => a.startsWith('--monolith-smoke-out=')) || '').slice(21) || process.env.MONOLITH_SMOKE_OUT || '';
const RELEASES_PAGE = `https://github.com/${updater.REPO}/releases/latest`;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// games are served to windows from game://<id>/<version>/<file>, checked file by file
protocol.registerSchemesAsPrivileged([{ scheme: 'game', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);

const DATA_DIR = path.join(app.getPath('documents'), 'Monolith');
const MAPS_DIR = path.join(DATA_DIR, 'maps');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BIN_DIR = path.join(app.getPath('userData'), 'bin');
const GAMES_DIR = path.join(app.getPath('userData'), 'games');
const CFG_FILE = path.join(app.getPath('userData'), 'settings.json');
const APP_DIR = path.join(__dirname, 'app');
for (const d of [DATA_DIR, MAPS_DIR, BACKUP_DIR]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }

let cfg = { bounds: null };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) }; } catch (e) {}
function saveCfg() { try { fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 1)); } catch (e) {} }

// a developer copy (never the installed app) can load games from folders and trust a test key
const DEV_FOLDERS = !app.isPackaged && process.env.MONOLITH_DEV_GAMES ? process.env.MONOLITH_DEV_GAMES.split(path.delimiter).filter(Boolean) : [];
if (!app.isPackaged && process.env.MONOLITH_TEST_PUBLIC_KEY) signing.addTestKey(process.env.MONOLITH_TEST_PUBLIC_KEY);
const DEV = !app.isPackaged;
const games = createGames({ dir: GAMES_DIR, appVersion: app.getVersion(), fetch: (u, o) => net.fetch(u, o), builtinList: path.join(__dirname, 'games.json'), devFolders: DEV_FOLDERS,
  listUrl: DEV && process.env.MONOLITH_GAMES_URL || undefined, githubBase: DEV && process.env.MONOLITH_GITHUB_BASE || undefined });

const adminKey = crypto.randomBytes(24).toString('hex');
let srv = null;
let srvReady = null;
let directPort = null;
let tunnelState = { state: 'off', url: '', msg: '' };
let mainWin = null;
const winGame = new Map(); // webContents id -> { id, version, role }

function ensureServer() {
  if (!srvReady) { srv = createServer({ assetsDir: MAPS_DIR, adminKey }); srvReady = srv.start(47020, '127.0.0.1'); }
  return srvReady;
}
const PAGES = { launcher: 'launcher.html', player: 'player.html', gm: 'gm.html', update: 'update.html' };
/* which of Monolith's pages sent this call (null if it isn't one of ours) */
function pageOf(e) {
  try {
    const u = new URL(e.senderFrame ? e.senderFrame.url : e.sender.getURL());
    if (u.protocol !== 'file:') return null;
    const p = path.normalize(decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
    if (path.dirname(p) !== path.normalize(APP_DIR)) return null;
    const name = path.basename(p);
    return Object.keys(PAGES).find((k) => PAGES[k] === name) || null;
  } catch (err) { return null; }
}
function handle(channel, pages, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    const pg = pageOf(e);
    if (!pg || !pages.includes(pg)) throw new Error('Not allowed from this window.');
    return fn(e, ...args);
  });
}

function hardenContents(wc) {
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  wc.on('destroyed', () => winGame.delete(wc.id));
}
const ICON = path.join(__dirname, 'build', 'icon.png');
const WEB = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true };

function showLauncher(win) { winGame.delete(win.webContents.id); win.setTitle('Monolith'); win.loadFile(path.join(APP_DIR, PAGES.launcher)); buildMenu(); }
function showGame(win, g) {
  winGame.set(win.webContents.id, g);
  win.loadFile(path.join(APP_DIR, g.role === 'gm' ? PAGES.gm : PAGES.player), { query: { game: g.id } });
  buildMenu();
}
function createMainWindow() {
  const b = cfg.bounds || {};
  mainWin = new BrowserWindow({ width: b.width || 1440, height: b.height || 920, x: b.x, y: b.y, minWidth: 1000, minHeight: 660,
    backgroundColor: '#000000', title: 'Monolith', show: false, icon: ICON, webPreferences: WEB });
  if (b.maximized) mainWin.maximize();
  hardenContents(mainWin.webContents);
  mainWin.once('ready-to-show', () => mainWin.show());
  const remember = () => { if (!mainWin || mainWin.isDestroyed()) return; cfg.bounds = { ...mainWin.getNormalBounds(), maximized: mainWin.isMaximized() }; saveCfg(); };
  mainWin.on('resize', remember); mainWin.on('move', remember);
  mainWin.on('closed', () => { mainWin = null; });
  showLauncher(mainWin);
}
function openPlayerWindow(g) {
  const w = new BrowserWindow({ width: 1280, height: 840, minWidth: 1000, minHeight: 660, backgroundColor: '#000000', title: 'Monolith · Player', icon: ICON, webPreferences: WEB });
  hardenContents(w.webContents);
  showGame(w, { id: g.id, version: g.version, role: 'player' });
}
function focusedGame() { const w = BrowserWindow.getFocusedWindow() || mainWin; return w ? winGame.get(w.webContents.id) || null : null; }

function buildMenu() {
  const about = () => dialog.showMessageBox(mainWin, { type: 'info', title: 'Monolith', message: `Monolith ${app.getVersion()}`,
    detail: `Characters, campaigns and an online map table for tabletop games.\n\nYour data: ${DATA_DIR}\nGames: ${GAMES_DIR}\nSigning key: ${signing.fingerprint()}\nOnline links by Cloudflare quick tunnels (cloudflared ${tunnel.CF_VERSION}).` });
  const g = mainWin ? winGame.get(mainWin.webContents.id) : null;
  const tpl = [
    ...(IS_MAC ? [{ label: app.name, submenu: [
      { label: 'About Monolith', click: about }, { label: 'Check for Updates…', click: () => runUpdate(true) },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: 'File', submenu: [
      { label: 'Your games', accelerator: 'CmdOrCtrl+Shift+H', click: () => { if (mainWin) showLauncher(mainWin); } },
      { label: 'Open a player window', enabled: !!g, click: () => { const x = focusedGame(); if (x) openPlayerWindow(x); } },
      { type: 'separator' },
      { label: 'Open data folder', click: () => shell.openPath(DATA_DIR) },
      { label: 'Open backups folder', click: () => shell.openPath(BACKUP_DIR) },
      ...(IS_MAC ? [{ type: 'separator' }, { role: 'close' }] : [{ type: 'separator' }, { role: 'quit', label: 'Exit' }]),
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools', label: 'Developer tools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    ...(IS_MAC ? [{ role: 'windowMenu' }] : []),
    { role: 'help', label: 'Help', submenu: [
      { label: 'Check for updates…', click: () => runUpdate(true) },
      { label: 'Download page', click: () => shell.openExternal(RELEASES_PAGE) },
      { type: 'separator' }, { label: 'About Monolith', click: about },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
// backup files: <game>-campaign-<name>-<id> or <game>-characters
const BACKUP_KIND = /^[a-z0-9][a-z0-9-]{0,39}-(campaign(-[a-z0-9]+)+|characters)$/;
function writeBackup(kind, text) {
  if (!BACKUP_KIND.test(String(kind)) || kind.length > 96 || typeof text !== 'string' || text.length > 60 * 1024 * 1024) return false;
  const day = new Date().toISOString().slice(0, 10);
  const tmp = path.join(BACKUP_DIR, `.${kind}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.copyFileSync(tmp, path.join(BACKUP_DIR, `${kind}-${day}.json`));
  fs.renameSync(tmp, path.join(BACKUP_DIR, `${kind}-latest.json`));
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => new RegExp(`^${kind}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f)).sort();
  while (old.length > 30) { try { fs.unlinkSync(path.join(BACKUP_DIR, old.shift())); } catch (e) {} }
  return true;
}
const cleanErr = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/* ---------------- IPC ---------------- */
const GAMEPAGES = ['player', 'gm'];
handle('app:version', ['launcher', 'player', 'gm', 'update'], async () => app.getVersion());
// the shelf
handle('games:shelf', ['launcher'], async (e, force) => { const s = await games.shelf(!!force); return { appVersion: app.getVersion(), ...s }; });
function statusTo(wc, id) { return (s) => { if (!wc.isDestroyed()) wc.send('games:status', { id, ...s }); }; }
handle('games:install', ['launcher'], async (e, id) => {
  try { const r = await games.install(String(id), statusTo(e.sender, id)); return { ok: true, version: r.version, name: r.name }; }
  catch (err) { return { ok: false, msg: cleanErr(err) }; }
});
handle('games:open', ['launcher'], async (e, id, role) => {
  id = String(id); role = role === 'gm' ? 'gm' : 'player';
  try {
    const p = await games.prepare(id, statusTo(e.sender, id));
    const win = BrowserWindow.fromWebContents(e.sender);
    if (role === 'gm') ensureServer().catch(() => {});
    setTimeout(() => showGame(win, { id, version: p.version, role }), 60);
    return { ok: true, version: p.version };
  } catch (err) { return { ok: false, msg: cleanErr(err) }; }
});
// a game window
handle('game:info', GAMEPAGES, async (e) => {
  const g = winGame.get(e.sender.id); if (!g) throw new Error('No game was chosen for this window.');
  const m = games.manifest(g.id, g.version);
  return { id: m.id, name: m.name, version: m.version, api: m.api || 1, rulesets: m.rulesets || [], entry: m.entry, css: m.css || [], skin: m.skin || '',
    tagline: m.tagline || '', base: `game://${g.id}/${m.version}/`, dev: games.isDev(g.id) };
});
handle('game:ensure', GAMEPAGES, async (e, id, version) => {
  const g = winGame.get(e.sender.id); if (!g || g.id !== id) return { ok: false, msg: 'This window plays another game.' };
  try {
    const r = await games.ensure(id, String(version));
    winGame.set(e.sender.id, { ...g, version: r.version });
    setTimeout(() => { if (!e.sender.isDestroyed()) e.sender.reload(); }, 150);
    return { ok: true, version: r.version };
  } catch (err) { return { ok: false, msg: cleanErr(err) }; }
});
handle('win:home', GAMEPAGES, async (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w === mainWin) showLauncher(w); else w.close(); return true; });
handle('win:player', ['gm'], async (e) => { const g = winGame.get(e.sender.id); if (g) openPlayerWindow(g); return true; });
// hosting
handle('server:info', ['gm'], async () => { const port = await ensureServer(); return { port, adminKey }; });
handle('host:state', ['gm'], async () => ({ tunnel: tunnelState, direct: directPort }));
handle('tunnel:start', ['gm'], async () => {
  const port = await ensureServer();
  return tunnel.start({ binDir: BIN_DIR, port, fetchImpl: (u) => net.fetch(u),
    onStatus: (s) => { tunnelState = s; for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('tunnel:status', s); } });
});
handle('tunnel:stop', ['gm'], async () => { tunnel.stop(); tunnelState = { state: 'off', url: '', msg: '' }; return true; });
handle('direct:start', ['gm'], async (e, port) => { await ensureServer(); directPort = await srv.listenPublic(Math.max(1024, Math.min(65535, Number(port) || 47021))); return { port: directPort }; });
handle('direct:stop', ['gm'], async () => { if (srv) await srv.closePublic(); directPort = null; return true; });
handle('net:lan', ['gm'], async () => lanIps());
handle('net:publicip', ['gm'], async () => { const res = await net.fetch('https://api.ipify.org?format=json'); const j = await res.json(); return /^[0-9a-f:.]+$/i.test(j.ip || '') ? j.ip : ''; });
// files
handle('backup:write', GAMEPAGES, async (e, kind, text) => writeBackup(kind, text));
handle('backup:open', GAMEPAGES, async () => shell.openPath(BACKUP_DIR));
handle('data:open', ['launcher', 'player', 'gm'], async () => shell.openPath(DATA_DIR));
handle('clip:write', GAMEPAGES, async (e, text) => { clipboard.writeText(String(text).slice(0, 100000)); return true; });
handle('pdf:save', GAMEPAGES, async (e, name) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, { title: 'Save PDF', defaultPath: path.join(app.getPath('documents'), (String(name || 'sheet').replace(/[^\w.-]+/g, '-') || 'sheet') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return { saved: false };
  const pdf = await e.sender.printToPDF({ printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(r.filePath, pdf); shell.openPath(r.filePath);
  return { saved: true, path: r.filePath };
});
handle('update:check', ['launcher'], async () => { runUpdate(true); return true; });
handle('update:skip', ['update'], async () => { skipUpdate(); return true; });

/* ---------------- updates ---------------- */
let updating = false;
let updWin = null;
let updAbort = null;
function updSend(s) { if (updWin && !updWin.isDestroyed()) updWin.webContents.send('update:status', s); }
function skipUpdate() { if (updAbort) { try { updAbort.abort(); } catch (e) {} } if (updWin && !updWin.isDestroyed()) updWin.close(); }
function openUpdateWindow() {
  updWin = new BrowserWindow({ width: 520, height: 300, resizable: false, minimizable: false, maximizable: false, parent: mainWin || undefined, modal: !!mainWin,
    backgroundColor: '#000000', title: 'Updating Monolith', autoHideMenuBar: true, show: false, icon: ICON, webPreferences: WEB });
  updWin.setMenu(null);
  hardenContents(updWin.webContents);
  updWin.on('closed', () => { updWin = null; if (updAbort) { try { updAbort.abort(); } catch (e) {} } });
  updWin.loadFile(path.join(APP_DIR, PAGES.update));
  return new Promise((r) => updWin.webContents.once('did-finish-load', () => { updWin.show(); r(); }));
}
async function runUpdate(manual) {
  if (updating) return;
  const allowed = (app.isPackaged && (process.platform === 'win32' || IS_MAC)) || process.env.MONOLITH_UPDATE_URL;
  if (!allowed) { if (manual) dialog.showMessageBox(mainWin, { type: 'info', message: 'Updates only run in the installed app.' }); return; }
  updating = true;
  let info = null;
  try {
    const current = (process.env.MONOLITH_UPDATE_URL && process.env.MONOLITH_UPDATE_PRETEND_VERSION) || app.getVersion();
    info = await updater.check((u, o) => net.fetch(u, o), current);
    if (!info) { if (manual) dialog.showMessageBox(mainWin, { type: 'info', title: 'Monolith', message: `You have the latest version (${app.getVersion()}).` }); return; }
    if (IS_MAC) {
      const can = updater.macCanSelfUpdate(updater.macBundle(app.getPath('exe')));
      if (!can.ok) {
        if (SMOKE_OUT) { smokeNote({ update: 'blocked', why: can.why }); return; }
        const r = await dialog.showMessageBox(mainWin, { type: 'info', title: 'Monolith', buttons: ['Open download page', 'Not now'], defaultId: 0, cancelId: 1,
          message: `Version ${info.version} is available.`, detail: 'To update by itself, Monolith needs to be in your Applications folder. Drag it there from the disk image, then open it from Applications.\n\nOr download the new version now.' });
        if (r.response === 0) shell.openExternal(RELEASES_PAGE);
        return;
      }
    }
    await openUpdateWindow();
    const base = { version: info.version, current: app.getVersion(), notes: info.notes };
    updSend({ ...base, state: 'downloading', pct: 0, got: 0, total: info.size });
    updAbort = new AbortController();
    const file = await updater.download((u, o) => net.fetch(u, o), info, path.join(app.getPath('temp'), 'Monolith-update'),
      (pct, got, total) => updSend({ ...base, state: 'downloading', pct, got, total }), updAbort.signal);
    updAbort = null;
    if (!updWin) return;
    updSend({ ...base, state: 'installing' });
    await new Promise((r) => setTimeout(r, 1200));
    if (IS_MAC) {
      await updater.prepareMacInstall(file, { bundle: updater.macBundle(app.getPath('exe')), pid: process.pid, version: info.version,
        tmpDir: path.join(app.getPath('temp'), 'Monolith-update'), relaunchArgs: SMOKE_OUT ? [`--monolith-smoke-out=${SMOKE_OUT}.after`] : [] });
      if (SMOKE_OUT) smokeNote({ update: 'handed-off' });
    } else updater.runInstaller(file);
    if (!process.env.MONOLITH_UPDATE_DRYRUN) setTimeout(() => app.quit(), 300);
  } catch (e) {
    updAbort = null;
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) return;
    console.error('[updater]', e);
    if (updWin) updSend({ version: info && info.version, current: app.getVersion(), state: 'error', msg: String(e.message || e) });
    else if (manual) dialog.showMessageBox(mainWin, { type: 'warning', title: 'Monolith', message: 'Couldn’t check for updates.', detail: String(e.message || e) });
    if (SMOKE_OUT) smokeNote({ update: 'error', updateError: String(e.message || e) });
  } finally { updating = false; }
}

/* ---------------- serving games ---------------- */
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8' };
function serveGame(req) {
  try {
    const u = new URL(req.url);
    const id = u.hostname; const parts = decodeURIComponent(u.pathname).replace(/^\/+/, '').split('/');
    const version = parts.shift(); const rel = parts.join('/');
    const buf = games.readFile(id, version, rel);
    const ext = (rel.split('.').pop() || '').toLowerCase();
    return new Response(buf, { status: 200, headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
  } catch (e) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
}

/* ---------------- lifecycle ---------------- */
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
app.whenReady().then(async () => {
  if (!gotLock) return;
  protocol.handle('game', serveGame);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  session.defaultSession.on('will-download', (e, item) => { item.setSaveDialogOptions({ title: 'Save file', defaultPath: path.join(app.getPath('documents'), item.getFilename()) }); });
  if (IS_MAC && app.isPackaged && !SMOKE_OUT && !cfg.askedMoveToApps && !app.isInApplicationsFolder()) {
    cfg.askedMoveToApps = true; saveCfg();
    const r = await dialog.showMessageBox({ type: 'question', buttons: ['Move to Applications', 'Not now'], defaultId: 0, cancelId: 1,
      message: 'Move Monolith to your Applications folder?', detail: 'It needs to be in Applications to update itself. Your games, characters and campaigns aren’t affected.' });
    if (r.response === 0) { try { if (app.moveToApplicationsFolder()) return; } catch (e) { dialog.showErrorBox('Couldn’t move the app', String(e.message || e)); } }
  }
  createMainWindow();
  if (SMOKE_OUT) runSmoke();
  else if (cfg.autoUpdate !== false) setTimeout(() => runUpdate(false), 2500);
});
app.on('window-all-closed', () => { app.quit(); });

/* ---------------- smoke test (release build only) ---------------- */
let smoke = {};
function smokeNote(o) { smoke = { ...smoke, ...o }; try { fs.writeFileSync(SMOKE_OUT, JSON.stringify(smoke, null, 1)); } catch (e) {} }
async function runSmoke() {
  smokeNote({ started: true, version: app.getVersion(), platform: process.platform, arch: process.arch, exe: app.getPath('exe'), packaged: app.isPackaged, inApplications: IS_MAC ? app.isInApplicationsFolder() : null, key: signing.fingerprint() });
  const done = (o) => { smokeNote({ ...o, finished: true }); setTimeout(() => app.quit(), 300); };
  try {
    await new Promise((r) => { if (mainWin.webContents.isLoading()) mainWin.webContents.once('did-finish-load', r); else r(); });
    smokeNote({ page: mainWin.webContents.getURL().split('/').pop(), desk: await mainWin.webContents.executeJavaScript('!!(window.monolithDesk)') });
    const shelf = await games.shelf(false).catch((e) => ({ error: String(e.message || e) }));
    smokeNote({ shelf: (shelf.games || []).map((g) => ({ id: g.id, installed: g.installed, available: g.available || null, err: g.availableError || '' })), listError: shelf.listError || shelf.error || '' });
    if (process.env.MONOLITH_SMOKE_GAME) {
      try {
        const id = process.env.MONOLITH_SMOKE_GAME;
        const p = await games.prepare(id, () => {});
        showGame(mainWin, { id, version: p.version, role: 'gm' });
        await new Promise((r) => mainWin.webContents.once('did-finish-load', r));
        await new Promise((r) => setTimeout(r, 2500));
        smokeNote({ game: id, gameVersion: p.version, gameStarted: await mainWin.webContents.executeJavaScript('!!(window.Monolith&&Monolith.gameDef&&document.querySelector("#nav").children.length)') });
      } catch (e) { smokeNote({ gameError: String(e.message || e) }); }
    }
    const port = await ensureServer();
    const res = await net.fetch(`http://127.0.0.1:${port}/`);
    smokeNote({ serverPort: port, serverStatus: res.status });
    if (process.env.MONOLITH_SMOKE_TUNNEL) {
      try {
        const url = await tunnel.start({ binDir: BIN_DIR, port, fetchImpl: (u) => net.fetch(u), onStatus: (s) => { tunnelState = s; } });
        let st = 0;
        for (let i = 0; i < 8 && st !== 200; i++) { try { st = (await net.fetch(url + '/')).status; } catch (e) {} if (st !== 200) await new Promise((r) => setTimeout(r, 2500)); }
        smokeNote({ tunnelUrl: url, tunnelStatus: st });
      } catch (e) { smokeNote({ tunnelError: String(e.message || e) }); }
      tunnel.stop();
    }
    if (process.env.MONOLITH_UPDATE_URL && !SMOKE_OUT.endsWith('.after')) { await runUpdate(false); if (smoke.update === 'handed-off') return; }
    done({ ok: true });
  } catch (e) { done({ ok: false, error: String(e && e.stack || e) }); }
}
app.on('before-quit', () => { try { tunnel.stop(); } catch (e) {} try { if (srv) srv.close(); } catch (e) {} });
