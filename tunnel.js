'use strict';
/*
 * Cloudflare quick tunnel: gives the GM's table a temporary public https address
 * without router setup. Downloads Cloudflare's official connector once (checksum-pinned).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');

const CF_VERSION = '2026.6.0';
const BINARIES = {
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: '03e322598e84d77406fa55b93f59e8e54636c5d8501d9dce36697fcf080ed8cc' },
  'linux-x64': { file: 'cloudflared-linux-amd64', sha256: '08d27c4c5d3ed73ee3e98ef2ddceb4ad09fd4cfc28e243565a189538e8ccd706' },
  // Mac downloads are .tgz archives: `sha256` pins the archive, `bin` the binary inside (the checksum Cloudflare publishes)
  'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', sha256: '88e17987423d3fd49167305f8bda14d83a80ab9f2097ff9c82b317a39e342119', bin: '1b66920a280235b0180e935c6fb2adcf91fceeeaf66c4365e606bd37d6c587ef' },
  'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', sha256: 'f6eaa91260ee327994331ac5ac2f7cec7925c4b6e15296b63fe0916992a06bdc', bin: '2d620f9e7b2ddf5e6f5fe1ed4eee308d8dc4c338bc936bfb18e0022a344daa66' },
};

// Pulls one regular file out of a .tar.gz held in memory (enough for Cloudflare's single-file archives).
function extractFromTgz(gz, wanted) {
  const tar = zlib.gunzipSync(gz);
  let off = 0;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0[\s\S]*$/, '');
    let name = str(0, 100);
    const prefix = str(345, 500);
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(str(124, 136).trim() || '0', 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const start = off + 512;
    if ((type === '0' || type === '\0') && path.posix.basename(name) === wanted) return Buffer.from(tar.subarray(start, start + size));
    off = start + Math.ceil(size / 512) * 512;
  }
  throw new Error('The connector download didn’t contain ' + wanted + '.');
}

let child = null;
let current = { state: 'off', url: '', msg: '' };

function binInfo() {
  return BINARIES[process.platform + '-' + process.arch] || null;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function ensureBinary(binDir, fetchImpl, onStatus) {
  const info = binInfo();
  if (!info) throw new Error('Online hosting isn’t available on this kind of computer. Use a direct connection instead.');
  fs.mkdirSync(binDir, { recursive: true });
  const target = path.join(binDir, `cloudflared-${CF_VERSION}${process.platform === 'win32' ? '.exe' : ''}`);
  const want = info.bin || info.sha256;
  if (fs.existsSync(target)) {
    try { if ((await sha256File(target)) === want) return target; } catch (e) {}
    try { fs.unlinkSync(target); } catch (e) {}
  }
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CF_VERSION}/${info.file}`;
  onStatus({ state: 'downloading', msg: `Downloading Cloudflare’s free connector (one time, about ${process.platform === 'darwin' ? 20 : 55} MB)…`, pct: 0 });
  let res;
  try { res = await fetchImpl(url); }
  catch (e) { throw new Error(`Couldn\u2019t download Cloudflare\u2019s connector (${e.message || e}). Check your internet connection, or allow Monolith through your antivirus or firewall.`); }
  if (!res.ok) throw new Error(`Couldn’t download Cloudflare’s connector (HTTP ${res.status}). Check your internet connection.`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = target + '.part';
  const out = fs.createWriteStream(tmp);
  const hash = crypto.createHash('sha256');
  let got = 0;
  let lastPct = -1;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = Buffer.from(value);
    hash.update(buf);
    got += buf.length;
    if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; onStatus({ state: 'downloading', msg: `Downloading Cloudflare’s connector… ${pct}%`, pct }); }
  }
  await new Promise((r) => out.end(r));
  if (hash.digest('hex') !== info.sha256) {
    try { fs.unlinkSync(tmp); } catch (e) {}
    throw new Error('The downloaded connector failed its safety check, so it was deleted. Try again.');
  }
  if (info.bin) {
    const exe = extractFromTgz(fs.readFileSync(tmp), 'cloudflared');
    try { fs.unlinkSync(tmp); } catch (e) {}
    if (crypto.createHash('sha256').update(exe).digest('hex') !== info.bin) throw new Error('The downloaded connector failed its safety check, so it was deleted. Try again.');
    fs.writeFileSync(tmp, exe);
  }
  fs.renameSync(tmp, target);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  return target;
}

function start({ binDir, port, fetchImpl, onStatus }) {
  const emit = (s) => { current = { ...current, ...s }; try { onStatus(current); } catch (e) {} };
  return new Promise(async (resolve, reject) => {
    let bin;
    try { bin = await ensureBinary(binDir, fetchImpl, emit); }
    catch (e) { emit({ state: 'error', msg: e.message, url: '' }); reject(e); return; }
    stop();
    emit({ state: 'starting', msg: 'Opening a secure link through Cloudflare…', url: '' });
    const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    let url = '';
    let settled = false;
    let tail = [];
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const why = tail.slice(-3).join(' ').slice(0, 300);
      emit({ state: 'error', msg: 'Cloudflare didn’t answer in time. ' + (why ? 'Details: ' + why : 'Check your internet connection or firewall.') });
      try { proc.kill(); } catch (e) {}
      reject(new Error('Cloudflare didn’t answer in time. Check your internet connection, or use a direct connection.'));
    }, 60000);
    const onLine = (line) => {
      tail.push(line.replace(/\s+/g, ' ').trim()); if (tail.length > 20) tail.shift();
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m && !url) { url = m[0]; emit({ state: 'starting', msg: 'Link created. Waiting for Cloudflare to finish connecting…', url }); }
      if (/Registered tunnel connection/i.test(line) && url && !settled) {
        settled = true; clearTimeout(timer);
        // new quick-tunnel names can take a few seconds to resolve worldwide
        setTimeout(() => { emit({ state: 'online', msg: 'Online', url }); resolve(url); }, 2500);
      }
      if (/failed to (request|unmarshal) quick Tunnel|error="?Unauthorized|too many requests/i.test(line) && !settled) {
        settled = true; clearTimeout(timer);
        emit({ state: 'error', msg: 'Cloudflare refused the link: ' + line.slice(0, 200) });
        try { proc.kill(); } catch (e) {}
        reject(new Error('Cloudflare couldn’t create a link right now. Wait a minute and try again, or use a direct connection.'));
      }
    };
    let buf = '';
    const onData = (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); emit({ state: 'error', msg: 'Couldn’t start Cloudflare’s connector: ' + e.message }); reject(e); } });
    proc.on('exit', (code) => {
      if (child === proc) child = null;
      if (!settled) { settled = true; clearTimeout(timer); const why = tail.slice(-2).join(' ').slice(0, 300); emit({ state: 'error', msg: 'Cloudflare’s connector stopped. ' + why }); reject(new Error('Cloudflare’s connector stopped before the link was ready. ' + why)); }
      else if (current.state === 'online') emit({ state: 'down', msg: 'The Cloudflare link dropped. Players can’t join until you go online again.', url: '' });
    });
  });
}

function stop() {
  if (child) { const c = child; child = null; current = { state: 'off', url: '', msg: '' }; try { c.kill(); } catch (e) {} }
}

module.exports = { start, stop, ensureBinary, extractFromTgz, BINARIES, CF_VERSION };
