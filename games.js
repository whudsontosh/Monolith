'use strict';
/*
 * Monolith's game manager: the approved list, installing, updating and serving games.
 *
 * Four checks stand between the internet and a game running in Monolith:
 *  1. Approved list. Only games in games.json (read from Monolith's own repository, with a copy
 *     built into the app) can be installed, and only from repositories owned by OWNER.
 *  2. Releases only. Games come from GitHub Releases, never from a branch.
 *  3. Signatures. release.json must carry a valid signature from Monolith's signing key; it
 *     lists the zip's SHA-256 and every file's SHA-256, and all of them are checked.
 *  4. Files are checked again whenever they're served to a window (game://<id>/<version>/<file>).
 * Each version installs into its own folder; earlier versions are kept for tables still on them.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const signing = require('./signing');

const OWNER = 'whudsontosh';
const MONOLITH_REPO = `${OWNER}/monolith`;
const LIST_URL = `https://raw.githubusercontent.com/${MONOLITH_REPO}/main/games.json`;
const API = 1;              // the Monolith API version this app provides to games
const KEEP_VERSIONS = 3;    // installed versions kept per game

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VER_RE = /^\d+\.\d+\.\d+$/;
const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}(\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}){0,3}$/;
function parseVer(v) { const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)$/); return m ? [+m[1], +m[2], +m[3]] : null; }
function cmpVer(a, b) { const x = parseVer(a), y = parseVer(b); if (!x || !y) return 0; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1; return 0; }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function withTimeout(ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; }

/* ---------- reading a zip (stored and deflate entries) ---------- */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('The game download isn’t a zip file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > 2000) throw new Error('The game download holds too many files.');
  const out = new Map(); let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The game download is damaged.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (!FILE_RE.test(name) || name.split('/').some((s) => s === '..' || s === '.')) throw new Error('The game download contains an unsafe file name.');
    total += usize; if (total > 200 * 1024 * 1024) throw new Error('The game download is too big.');
    const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: 100 * 1024 * 1024 });
    else throw new Error('The game download uses a compression Monolith can’t read.');
    if (data.length !== usize) throw new Error('The game download is damaged.');
    out.set(name, data);
  }
  return out;
}

/* ---------- checking a release ---------- */
/** Checks release.json bytes + signature for game `id`. Returns the parsed release or throws. */
function checkRelease(id, bytes, sig, appVersion, wantVersion) {
  if (!signing.verify(bytes, sig)) throw new Error('This release isn’t signed with Monolith’s key, so it wasn’t installed.');
  let r; try { r = JSON.parse(bytes.toString('utf8')); } catch (e) { throw new Error('The release information is damaged.'); }
  if (!r || r.format !== 'monolith-game-release' || r.id !== id) throw new Error('The release is for a different game.');
  if (!VER_RE.test(r.version || '')) throw new Error('The release has no proper version number.');
  if (wantVersion && r.version !== wantVersion) throw new Error(`Asked for version ${wantVersion}, but the release is ${r.version}.`);
  if (!/^[a-f0-9]{64}$/.test(r.sha256 || '') || !r.files || typeof r.files !== 'object') throw new Error('The release has no checksums, so it wasn’t installed.');
  if (!/^[A-Za-z0-9_.-]{1,80}\.zip$/.test(r.file || '')) throw new Error('The release names an unexpected file.');
  for (const [f, h] of Object.entries(r.files)) if (!FILE_RE.test(f) || !/^[a-f0-9]{64}$/.test(h)) throw new Error('The release lists an unsafe file.');
  if (!r.files['game.json']) throw new Error('The release has no game.json.');
  if ((Number(r.api) || 1) > API || (r.minMonolith && cmpVer(r.minMonolith, appVersion) > 0)) {
    const need = (Number(r.api) || 1) > API ? 'a newer Monolith' : `Monolith ${r.minMonolith} or later`;
    const e = new Error(`${r.name || 'This game'} ${r.version} needs ${need}. Update Monolith first (Check for updates).`); e.code = 'NEEDS_MONOLITH'; throw e;
  }
  return r;
}

function createGames(opts) {
  const dir = opts.dir;                       // where games are installed
  const appVersion = opts.appVersion;
  const fetchImpl = opts.fetch;               // (url, opts) -> Response
  const builtinList = opts.builtinList;       // path to the games.json shipped in the app
  const devFolders = (opts.devFolders || []).filter(Boolean); // developer copy only
  const listUrl = opts.listUrl || LIST_URL;                     // tests point these at a local server
  const githubBase = opts.githubBase || 'https://github.com/';
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  let state = { games: {} };
  try { state = { games: {}, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (e) {}
  const saveState = () => { const tmp = stateFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 1)); fs.renameSync(tmp, stateFile); };
  let list = null; let listError = ''; let listAt = 0;
  const verified = new Map(); // "<id>/<version>" -> release (signature checked this session)

  /* ----- the approved list ----- */
  function cleanList(j) {
    if (!j || j.format !== 'monolith-games' || !Array.isArray(j.games)) throw new Error('The list of games is damaged.');
    return j.games.filter((g) => g && ID_RE.test(g.id || '') && typeof g.repo === 'string' && g.repo.startsWith(OWNER + '/') && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(g.repo))
      .map((g) => ({ id: g.id, repo: g.repo, name: String(g.name || g.id).slice(0, 60), tagline: String(g.tagline || '').slice(0, 200),
        rulesets: (Array.isArray(g.rulesets) ? g.rulesets : []).slice(0, 12).map((r) => ({ id: String(r.id || '').slice(0, 40), name: String(r.name || '').slice(0, 60) })) }));
  }
  function builtin() { try { return cleanList(JSON.parse(fs.readFileSync(builtinList, 'utf8'))); } catch (e) { return []; } }
  async function approved(force) {
    if (list && !force && Date.now() - listAt < 10 * 60 * 1000) return list;
    const to = withTimeout(8000);
    try {
      const res = await fetchImpl(listUrl + (listUrl.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: to.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      list = cleanList(await res.json()); listError = ''; listAt = Date.now();
    } catch (e) {
      listError = String(e && e.message || e); if (!list) list = builtin();
    } finally { to.done(); }
    return list;
  }
  function entry(id) { return (list || builtin()).find((g) => g.id === id) || null; }

  /* ----- what's installed ----- */
  function devGame(id) {
    for (const f of devFolders) { try { const m = JSON.parse(fs.readFileSync(path.join(f, 'game.json'), 'utf8')); if (m.id === id) return { folder: f, manifest: m }; } catch (e) {} }
    return null;
  }
  function devGames() { const out = []; for (const f of devFolders) { try { const m = JSON.parse(fs.readFileSync(path.join(f, 'game.json'), 'utf8')); if (ID_RE.test(m.id || '')) out.push({ folder: f, manifest: m }); } catch (e) {} } return out; }
  function versionDir(id, v) { return path.join(dir, id, v); }
  function installedVersions(id) { const g = state.games[id]; return g ? (g.versions || []).filter((v) => fs.existsSync(path.join(versionDir(id, v), 'release.json'))) : []; }
  function active(id) { const g = state.games[id]; const vs = installedVersions(id); if (!vs.length) return null; return g.active && vs.includes(g.active) ? g.active : vs.sort(cmpVer).pop(); }
  function loadRelease(id, v) {
    const key = id + '/' + v; if (verified.has(key)) return verified.get(key);
    const d = versionDir(id, v);
    const bytes = fs.readFileSync(path.join(d, 'release.json')); const sig = fs.readFileSync(path.join(d, 'release.json.sig'), 'utf8');
    const r = checkRelease(id, bytes, sig, '999.0.0', v); // the Monolith-version check happened at install
    verified.set(key, r); return r;
  }
  function manifest(id, v) { const d = devGame(id); if (d) return d.manifest; const r = loadRelease(id, v); const m = JSON.parse(readFile(id, v, 'game.json').toString('utf8')); if (m.id !== id || m.version !== r.version) throw new Error('The installed game doesn’t match its release.'); return m; }

  /* ----- serving files to windows ----- */
  function readFile(id, v, rel) {
    const d = devGame(id);
    if (d) { const p = path.resolve(d.folder, rel); if (!p.startsWith(path.resolve(d.folder) + path.sep)) throw new Error('outside'); return fs.readFileSync(p); }
    if (!ID_RE.test(id) || !VER_RE.test(v) || !FILE_RE.test(rel)) throw new Error('bad path');
    const r = loadRelease(id, v);
    const want = r.files[rel]; if (!want) throw new Error('not in release');
    const buf = fs.readFileSync(path.join(versionDir(id, v), ...rel.split('/')));
    if (sha256(buf) !== want) throw new Error('The installed file was changed; reinstall the game.');
    return buf;
  }

  /* ----- downloading ----- */
  async function getBytes(url, onProgress, max) {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (res.status === 404) { const e = new Error('not found'); e.code = 'NOT_FOUND'; throw e; }
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (max && total > max) throw new Error('The download is larger than expected.');
    const chunks = []; let got = 0; const reader = res.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; if (max && got > max) throw new Error('The download is larger than expected.'); chunks.push(Buffer.from(value)); if (onProgress) onProgress(got, total); }
    return Buffer.concat(chunks);
  }
  function releaseBase(repo, version) { return version ? `${githubBase}${repo}/releases/download/v${version}/` : `${githubBase}${repo}/releases/latest/download/`; }
  async function fetchRelease(id, version) {
    const g = entry(id) || (await approved(false), entry(id));
    if (!g) throw new Error('That game isn’t on Monolith’s approved list.');
    const base = releaseBase(g.repo, version);
    let bytes, sig;
    try { [bytes, sig] = await Promise.all([getBytes(base + 'release.json', null, 2e6), getBytes(base + 'release.json.sig', null, 4096)]); }
    catch (e) { if (e.code === 'NOT_FOUND') throw new Error(version ? `${g.name} ${version} isn’t published.` : `${g.name} has no releases yet.`); throw e; }
    const r = checkRelease(id, bytes, sig.toString('utf8'), appVersion, version || null);
    return { g, base, bytes, sig: sig.toString('utf8'), r };
  }
  /** Installs a checked release. status({msg, pct}) reports progress. */
  async function installRelease(rel, status) {
    const { g, base, bytes, sig, r } = rel; const id = g.id;
    if (installedVersions(id).includes(r.version)) { loadRelease(id, r.version); return r; }
    status({ msg: `Downloading ${g.name} ${r.version}…`, pct: 5 });
    const zip = await getBytes(base + r.file, (got, total) => status({ msg: `Downloading ${g.name} ${r.version}…`, pct: 5 + Math.round(80 * got / (total || r.size || got)) }), 150e6);
    status({ msg: 'Checking it against Monolith’s signing key…', pct: 88 });
    if (zip.length !== Number(r.size) || sha256(zip) !== r.sha256) throw new Error('The download failed its safety check, so it was thrown away.');
    const files = unzip(zip);
    const names = [...files.keys()].sort(); const listed = Object.keys(r.files).sort();
    if (names.length !== listed.length || names.some((n, i) => n !== listed[i])) throw new Error('The download doesn’t hold exactly the files its release lists.');
    for (const [n, buf] of files) if (sha256(buf) !== r.files[n]) throw new Error('A file in the download failed its safety check.');
    const m = JSON.parse(files.get('game.json').toString('utf8'));
    if (m.id !== id || m.version !== r.version) throw new Error('The game inside the download doesn’t match its release.');
    status({ msg: 'Installing…', pct: 95 });
    const final = versionDir(id, r.version); const tmp = final + '.part-' + process.pid;
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [n, buf] of files) { const p = path.join(tmp, ...n.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); }
    fs.writeFileSync(path.join(tmp, 'release.json'), bytes); fs.writeFileSync(path.join(tmp, 'release.json.sig'), sig);
    fs.rmSync(final, { recursive: true, force: true }); fs.renameSync(tmp, final);
    const s = state.games[id] || (state.games[id] = { versions: [] });
    s.versions = [...new Set([...(s.versions || []), r.version])].sort(cmpVer);
    // keep the newest few, and whatever is active
    while (s.versions.length > KEEP_VERSIONS) { const old = s.versions.find((v) => v !== s.active && v !== r.version); if (!old) break; s.versions = s.versions.filter((v) => v !== old); fs.rmSync(versionDir(id, old), { recursive: true, force: true }); verified.delete(id + '/' + old); }
    saveState(); verified.set(id + '/' + r.version, r);
    status({ msg: `${g.name} ${r.version} is installed.`, pct: 100 });
    return r;
  }
  function setActive(id, v) { const s = state.games[id] || (state.games[id] = { versions: [] }); s.active = v; saveState(); }

  return {
    API, OWNER,
    /** the shelf: approved games, what's installed, and whether there's something newer */
    async shelf(force) {
      const l = await approved(force);
      const out = l.map((g) => { const v = active(g.id); return { ...g, installed: v ? { version: v } : null }; });
      for (const d of devGames()) { const m = d.manifest; const o = out.find((x) => x.id === m.id); const info = { id: m.id, name: m.name, tagline: m.tagline || '', rulesets: m.rulesets || [], installed: { version: m.version }, dev: true }; if (o) Object.assign(o, info); else out.push(info); }
      // look for newer releases of what's installed (in the background of the shelf; failures are quiet)
      await Promise.all(out.filter((g) => g.installed && !g.dev).map(async (g) => {
        try { const { r } = await fetchRelease(g.id, null); g.available = { version: r.version, size: r.size, newer: cmpVer(r.version, g.installed.version) > 0 }; } catch (e) {}
      }));
      await Promise.all(out.filter((g) => !g.installed).map(async (g) => {
        try { const { r } = await fetchRelease(g.id, null); g.available = { version: r.version, size: r.size }; } catch (e) { g.availableError = String(e.message || e); }
      }));
      return { games: out, listError };
    },
    async install(id, status) { const rel = await fetchRelease(id, null); const r = await installRelease(rel, status); setActive(id, r.version); return r; },
    /** before opening a game: get the newest release if there is one; keep working offline */
    async prepare(id, status) {
      if (devGame(id)) return { version: devGame(id).manifest.version, dev: true };
      const cur = active(id);
      try {
        const rel = await fetchRelease(id, null);
        if (!cur || cmpVer(rel.r.version, cur) > 0) { const r = await installRelease(rel, status); setActive(id, r.version); return { version: r.version, updated: !!cur }; }
      } catch (e) { if (!cur) throw e; status({ msg: e.code === 'NEEDS_MONOLITH' ? 'A newer version needs a newer Monolith. Opening the one you have.' : 'Couldn’t check for a newer version. Opening the one you have.', pct: 100, note: e.code === 'NEEDS_MONOLITH' ? String(e.message) : '' }); }
      return { version: cur };
    },
    /** exactly this version (a table runs the GM's version) */
    async ensure(id, version, status) {
      if (!VER_RE.test(version || '')) throw new Error('That isn’t a version number.');
      if (devGame(id)) throw new Error('A game loaded from a folder can’t switch versions.');
      if (installedVersions(id).includes(version)) { loadRelease(id, version); return { version }; }
      const rel = await fetchRelease(id, version); const r = await installRelease(rel, status || (() => {}));
      if (!active(id) || cmpVer(r.version, active(id)) > 0) setActive(id, r.version);
      return { version: r.version };
    },
    active, installedVersions, manifest, readFile, isDev: (id) => !!devGame(id), entry,
  };
}

module.exports = { createGames, checkRelease, unzip, cmpVer, LIST_URL, OWNER, API };
