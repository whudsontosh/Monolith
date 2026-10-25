'use strict';
/* The game manager: approved list, signed releases, checksums, unzipping, versions, serving. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const signing = require('../signing');
const { createGames, unzip } = require('../games');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); }
async function throwsLike(p, re, m) { try { await p; ok(false, m + ' (no error)'); } catch (e) { ok(re.test(e.message), m + ' (' + e.message + ')'); } }

// a test key the app is told to trust (the real key stays with the publisher)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
signing.addTestKey(publicKey.export({ type: 'spki', format: 'pem' }));
const other = crypto.generateKeyPairSync('ed25519').privateKey;
const sign = (buf, key = privateKey) => crypto.sign(null, buf, key).toString('base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* a zip writer (deflate) for building releases */
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name), d = zlib.deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    parts.push(h, n, d);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
/* a fake GitHub: url -> bytes */
const web = new Map();
function release(id, version, opt = {}) {
  const files = { 'game.json': Buffer.from(JSON.stringify({ id, name: 'Demo', version, api: 1, entry: { player: ['player.js'] } })), 'player.js': Buffer.from(`/* ${id} ${version} */`), 'fonts/a.woff2': Buffer.from('font'), ...(opt.extra || {}) };
  const z = opt.zip || zip(files);
  const listed = {}; for (const [n, d] of Object.entries(files)) if (!(opt.unlisted || []).includes(n)) listed[n] = sha(d);
  const r = { format: 'monolith-game-release', id: opt.relId || id, name: 'Demo', version, api: opt.api || 1, minMonolith: opt.min || '1.0.0', file: `${id}-${version}.zip`, size: z.length, sha256: opt.badSha ? 'f'.repeat(64) : sha(z), files: listed };
  const bytes = Buffer.from(JSON.stringify(r));
  const base = (latest) => latest ? `https://github.com/whudsontosh/${id}-repo/releases/latest/download/` : `https://github.com/whudsontosh/${id}-repo/releases/download/v${version}/`;
  for (const latest of opt.latest ? [true, false] : [false]) {
    web.set(base(latest) + 'release.json', bytes);
    web.set(base(latest) + 'release.json.sig', Buffer.from(opt.sigKey === 'none' ? 'AAAA' : sign(bytes, opt.sigKey || privateKey)));
    web.set(base(latest) + r.file, opt.tamper ? Buffer.concat([z, Buffer.from('x')]) : z);
  }
}
let offline = false;
async function fakeFetch(url) {
  if (offline) throw new Error('offline');
  const u = url.split('?')[0];
  if (u.startsWith('https://list.test/')) return new Response(JSON.stringify(LIST), { status: 200 });
  const b = web.get(u);
  if (!b) return new Response('nope', { status: 404 });
  return new Response(b, { status: 200, headers: { 'content-length': String(b.length) } });
}
const LIST = { format: 'monolith-games', games: [
  { id: 'demo', name: 'Demo', repo: 'whudsontosh/demo-repo' },
  { id: 'evil', name: 'Evil', repo: 'someoneelse/evil' },
  { id: 'bad', name: 'Bad', repo: 'whudsontosh/bad-repo' },
  { id: 'newer', name: 'Newer', repo: 'whudsontosh/newer-repo' },
] };

(async () => {
  const mk = (o) => createGames({ listUrl: 'https://list.test/games.json', ...o });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-games-'));
  const builtin = path.join(dir, 'builtin.json'); fs.writeFileSync(builtin, JSON.stringify(LIST));
  const G = mk({ dir: path.join(dir, 'games'), appVersion: '1.0.0', fetch: fakeFetch, builtinList: builtin });
  release('demo', '1.0.0', { latest: true });
  let shelf = await G.shelf(true);
  ok(!shelf.games.some((g) => g.id === 'evil'), 'games from repositories Monolith’s owner doesn’t own are dropped from the list');
  ok(shelf.games.find((g) => g.id === 'demo').available.version === '1.0.0', 'the shelf sees the latest release');
  const msgs = []; const r = await G.install('demo', (s) => msgs.push(s));
  ok(r.version === '1.0.0' && G.active('demo') === '1.0.0', 'a signed release installs and becomes active');
  ok(msgs.some((m) => /safety|signing key/i.test(m.msg)) && msgs[msgs.length - 1].pct === 100, 'install reports progress, including the check');
  ok(G.readFile('demo', '1.0.0', 'player.js').toString().includes('demo 1.0.0'), 'files are served from the installed version');
  ok(G.readFile('demo', '1.0.0', 'fonts/a.woff2').toString() === 'font', 'files in folders are served');
  ok(G.manifest('demo', '1.0.0').version === '1.0.0', 'the manifest matches its release');
  try { G.readFile('demo', '1.0.0', '../state.json'); ok(false, 'path escape blocked'); } catch (e) { ok(true, 'paths outside the game are refused'); }
  try { G.readFile('demo', '1.0.0', 'release.json'); ok(false, 'unlisted file blocked'); } catch (e) { ok(true, 'files the release doesn’t list are never served'); }
  fs.appendFileSync(path.join(dir, 'games', 'demo', '1.0.0', 'player.js'), '\nalert(1)');
  try { G.readFile('demo', '1.0.0', 'player.js'); ok(false, 'tampered file served'); } catch (e) { ok(/changed/.test(e.message), 'a file changed on disk after install is refused'); }
  // a second session re-checks the stored signature
  const sigPath = path.join(dir, 'games', 'demo', '1.0.0', 'release.json.sig');
  const goodSig = fs.readFileSync(sigPath, 'utf8'); fs.writeFileSync(sigPath, sign(Buffer.from('x')));
  const G2 = mk({ dir: path.join(dir, 'games'), appVersion: '1.0.0', fetch: fakeFetch, builtinList: builtin });
  try { G2.readFile('demo', '1.0.0', 'fonts/a.woff2'); ok(false, 'bad stored sig'); } catch (e) { ok(/signed/.test(e.message), 'a stored release whose signature no longer checks out is refused'); }
  fs.writeFileSync(sigPath, goodSig);

  // updates: prepare picks up a newer release; ensure gets an exact version; old ones are kept
  release('demo', '1.1.0', { latest: true });
  const p = await G.prepare('demo', () => {});
  ok(p.version === '1.1.0' && p.updated && G.active('demo') === '1.1.0', 'opening a game installs a newer release first');
  ok(G.installedVersions('demo').includes('1.0.0'), 'the previous version is kept');
  const e1 = await G.ensure('demo', '1.0.0');
  ok(e1.version === '1.0.0' && G.active('demo') === '1.1.0', 'an exact older version is available for a table without changing the active one');
  release('demo', '0.9.0'); await G.ensure('demo', '0.9.0'); release('demo', '0.8.0'); await G.ensure('demo', '0.8.0');
  ok(G.installedVersions('demo').length === 3 && G.installedVersions('demo').includes('1.1.0'), 'only the newest few versions are kept, never the active one: ' + G.installedVersions('demo'));
  offline = true;
  const off = await G.prepare('demo', () => {});
  ok(off.version === '1.1.0', 'offline, the installed version opens');
  offline = false;
  await throwsLike(G.ensure('demo', '9.9.9'), /isn.t published/, 'asking for a version that doesn’t exist says so');

  // refusals
  release('bad', '1.0.0', { latest: true, sigKey: other });
  await throwsLike(G.install('bad', () => {}), /signed with Monolith/, 'a release signed with another key is refused');
  web.clear(); release('bad', '1.0.0', { latest: true, sigKey: 'none' });
  await throwsLike(G.install('bad', () => {}), /signed with Monolith/, 'a release without a real signature is refused');
  web.clear(); release('bad', '1.0.0', { latest: true, tamper: true });
  await throwsLike(G.install('bad', () => {}), /safety check/, 'a download that doesn’t match its checksum is thrown away');
  web.clear(); release('bad', '1.0.0', { latest: true, relId: 'demo' });
  await throwsLike(G.install('bad', () => {}), /different game/, 'a release for another game is refused');
  web.clear(); release('bad', '1.0.0', { latest: true, extra: { 'sneaky.js': Buffer.from('x') }, unlisted: ['sneaky.js'] });
  await throwsLike(G.install('bad', () => {}), /exactly the files/, 'a download with files its release doesn’t list is refused');
  web.clear(); release('newer', '2.0.0', { latest: true, min: '1.4.0' });
  await throwsLike(G.install('newer', () => {}), /needs Monolith 1\.4\.0 or later/, 'a game that needs a newer Monolith asks you to update Monolith');
  web.clear(); release('newer', '2.0.0', { latest: true, api: 2 });
  await throwsLike(G.install('newer', () => {}), /needs a newer Monolith/, 'a game built for a newer Monolith API is refused');
  await throwsLike(G.install('evil', () => {}), /approved list/, 'a game that isn’t approved can’t be installed');
  ok(!fs.readdirSync(path.join(dir, 'games')).includes('bad'), 'nothing from a refused release is left on disk');
  // unsafe zips
  const evil = zip({ '../x.js': Buffer.from('x') });
  try { unzip(evil); ok(false, 'traversal'); } catch (e) { ok(/unsafe/.test(e.message), 'zip entries that climb out of the folder are refused'); }
  // developer folders (developer copies only; the installed app never passes any)
  const dev = path.join(dir, 'devgame'); fs.mkdirSync(dev); fs.writeFileSync(path.join(dev, 'game.json'), JSON.stringify({ id: 'devg', name: 'Dev', version: '0.0.1', entry: { player: ['p.js'] } })); fs.writeFileSync(path.join(dev, 'p.js'), 'dev');
  const G3 = mk({ dir: path.join(dir, 'games'), appVersion: '1.0.0', fetch: fakeFetch, builtinList: builtin, devFolders: [dev] });
  shelf = await G3.shelf(false);
  ok(shelf.games.some((g) => g.id === 'devg' && g.dev), 'a developer copy lists a game from a folder');
  ok(G3.readFile('devg', '0.0.1', 'p.js').toString() === 'dev', 'and serves it without a release');
  try { G3.readFile('devg', '0.0.1', '../games/state.json'); ok(false, 'dev escape'); } catch (e) { ok(true, 'even then, nothing outside its folder'); }
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
