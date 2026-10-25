'use strict';
/*
 * Monolith's self-updater. Each launch the app reads latest.json from the newest release in
 * Monolith's own repository. latest.json must be signed with Monolith's signing key
 * (latest.json.sig); if it is, and the version is newer, the app downloads this platform's build
 * and checks it against the SHA-256 in that signed file.
 *  - Windows: runs the installer silently and quits; the installer reopens the app.
 *  - macOS (1.4.0+): unpacks the new .app next to the current one, then a small helper
 *    script waits for the app to quit, swaps the bundles and reopens it.
 * latest.json lists every platform under "platforms".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const signing = require('./signing');

const REPO = 'whudsontosh/monolith';
const LATEST_URL = process.env.MONOLITH_UPDATE_URL || `https://github.com/${REPO}/releases/latest/download/latest.json`;
const ASSET_PREFIX = process.env.MONOLITH_UPDATE_ASSET_PREFIX || `https://github.com/${REPO}/releases/download/`;

function parseVer(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function newer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
  return false;
}

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

function pickAsset(info, platform) {
  const p = info && info.platforms && typeof info.platforms === 'object' ? info.platforms[platform] : null;
  return p && typeof p === 'object' ? p : null;
}

async function check(fetchImpl, current, platform = process.platform) {
  const to = withTimeout(10000);
  let res;
  try { res = await fetchImpl(LATEST_URL + (LATEST_URL.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: to.signal, cache: 'no-store' }); }
  finally { to.done(); }
  if (res.status === 404) return null; // no releases yet
  if (!res.ok) throw new Error(`Update check failed (HTTP ${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const to2 = withTimeout(10000);
  let sres;
  try { sres = await fetchImpl(LATEST_URL.replace(/latest\.json(\?|$)/, 'latest.json.sig$1') + (LATEST_URL.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: to2.signal, cache: 'no-store' }); }
  finally { to2.done(); }
  if (!sres.ok || !signing.verify(bytes, await sres.text())) throw new Error('The update isn\u2019t signed with Monolith\u2019s key, so it was ignored.');
  let info;
  try { info = JSON.parse(bytes.toString('utf8')); } catch (e) { throw new Error('The update information was damaged.'); }
  if (!info || !parseVer(info.version)) throw new Error('The update information was incomplete.');
  if (!newer(info.version, current)) return null;
  const a = pickAsset(info, platform);
  if (!a) return null; // this release has nothing for this platform
  if (typeof a.url !== 'string' || !a.url.toLowerCase().startsWith(ASSET_PREFIX.toLowerCase())) throw new Error('The update points somewhere unexpected, so it was ignored.');
  if (!/^[a-f0-9]{64}$/.test(a.sha256 || '')) throw new Error('The update has no checksum, so it was ignored.');
  const file = String(a.file || (platform === 'darwin' ? 'Monolith-mac.zip' : 'Monolith-Setup.exe')).replace(/[^\w.-]/g, '');
  if (platform === 'darwin' && !/\.zip$/i.test(file)) throw new Error('The Mac update isn\u2019t a .zip, so it was ignored.');
  return {
    version: String(info.version).replace(/^v/i, ''),
    url: a.url,
    sha256: a.sha256,
    size: Number(a.size) || 0,
    file,
    notes: String(info.notes || '').slice(0, 2000),
  };
}

async function download(fetchImpl, info, dir, onProgress, signal) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, info.file);
  // reuse a finished download from an earlier attempt
  if (fs.existsSync(target)) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (h === info.sha256) { onProgress(100, info.size, info.size); return target; }
    try { fs.unlinkSync(target); } catch (e) {}
  }
  const res = await fetchImpl(info.url, { signal });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || info.size || 0;
  const tmp = target + '.part';
  const out = fs.createWriteStream(tmp);
  const hash = crypto.createHash('sha256');
  let got = 0, last = -1;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      got += buf.length;
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      const pct = total ? Math.min(100, Math.floor((got / total) * 100)) : 0;
      if (pct !== last) { last = pct; onProgress(pct, got, total); }
    }
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
  await new Promise((r) => out.end(r));
  if (hash.digest('hex') !== info.sha256) {
    try { fs.unlinkSync(tmp); } catch (e) {}
    throw new Error('The downloaded update failed its safety check, so it was deleted.');
  }
  fs.renameSync(tmp, target);
  return target;
}

function runInstaller(file) {
  if (process.env.MONOLITH_UPDATE_DRYRUN) { console.log('[updater] would run', file); return; }
  const child = spawn(file, ['/S'], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

/* ---------------- macOS ---------------- */
// The .app bundle this process runs from (…/Monolith.app/Contents/MacOS/Monolith)
function macBundle(exePath) {
  const b = path.resolve(exePath, '..', '..', '..');
  return /\.app$/i.test(b) ? b : null;
}
// Can this copy update itself? Not from a disk image, a read-only folder, or macOS's quarantine copy ("App Translocation").
function macCanSelfUpdate(bundle) {
  if (!bundle) return { ok: false, why: 'not-bundle' };
  if (/\/AppTranslocation\//.test(bundle)) return { ok: false, why: 'translocated' };
  if (bundle.startsWith('/Volumes/')) return { ok: false, why: 'disk-image' };
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); } catch (e) { return { ok: false, why: 'read-only' }; }
  return { ok: true };
}
function plistVersion(appDir) {
  try {
    const x = fs.readFileSync(path.join(appDir, 'Contents', 'Info.plist'), 'utf8');
    const m = x.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    return m ? m[1].trim() : '';
  } catch (e) { return ''; }
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} failed (${code}): ${err.slice(0, 300)}`))));
  });
}
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
/*
 * Unpacks the downloaded zip beside the running app and starts a detached helper that waits for
 * this process to exit, swaps in the new bundle (restoring the old one if anything fails),
 * and reopens the app. Returns the helper's log path. The caller quits the app afterwards.
 */
async function prepareMacInstall(zipFile, { bundle, pid, version, tmpDir, relaunchArgs = [] }) {
  const can = macCanSelfUpdate(bundle);
  if (!can.ok) { const e = new Error('This copy of the app can’t update itself.'); e.code = 'MAC_NOT_WRITABLE'; e.why = can.why; throw e; }
  const parent = path.dirname(bundle);
  const tag = Date.now().toString(36);
  const stage = path.join(parent, `.monolith-update-${tag}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    await run('/usr/bin/ditto', ['-x', '-k', zipFile, stage]);
    const found = fs.readdirSync(stage).find((n) => /\.app$/i.test(n));
    if (!found) throw new Error('The update didn’t contain the app.');
    const fresh = path.join(stage, found);
    const v = plistVersion(fresh);
    if (version && v && v !== version) throw new Error(`The update contained version ${v}, not ${version}.`);
    if (!fs.existsSync(path.join(fresh, 'Contents', 'MacOS'))) throw new Error('The update looked incomplete.');
    fs.mkdirSync(tmpDir, { recursive: true });
    const log = path.join(tmpDir, 'mac-update.log');
    const script = path.join(tmpDir, `mac-update-${tag}.sh`);
    const old = path.join(parent, `.monolith-old-${tag}.app`);
    fs.writeFileSync(script, `#!/bin/bash
# Monolith updater helper (written by the app; safe to delete)
exec >>${shq(log)} 2>&1
echo "[$(date)] updating ${version}"
for i in $(seq 1 300); do kill -0 ${Number(pid)} 2>/dev/null || break; sleep 0.2; done
APP=${shq(bundle)}; NEW=${shq(fresh)}; OLD=${shq(old)}; STAGE=${shq(stage)}
if mv "$APP" "$OLD"; then
  if mv "$NEW" "$APP"; then
    rm -rf "$OLD"
    /usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null
    echo "swapped"
  else
    echo "could not move the new app into place; restoring"
    mv "$OLD" "$APP"
  fi
else
  echo "could not move the old app aside"
fi
rm -rf "$STAGE"
unset MONOLITH_UPDATE_URL MONOLITH_UPDATE_ASSET_PREFIX MONOLITH_UPDATE_PRETEND_VERSION MONOLITH_UPDATE_DRYRUN MONOLITH_SMOKE_TUNNEL
/usr/bin/open -n "$APP"${relaunchArgs.length ? ' --args ' + relaunchArgs.map(shq).join(' ') : ''}
rm -f "$0"
`, { mode: 0o755 });
    if (process.env.MONOLITH_UPDATE_DRYRUN) { console.log('[updater] would run', script); return log; }
    const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
    child.unref();
    return log;
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

module.exports = { check, download, runInstaller, newer, pickAsset, macBundle, macCanSelfUpdate, prepareMacInstall, LATEST_URL, REPO };
