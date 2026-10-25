'use strict';
/*
 * Monolith table server.
 * A small relay that runs inside the GM's app. The GM's window connects as the "admin"
 * and is the only authority on game state; players connect, prove the room password,
 * and their messages are passed to the GM. It also serves map images to players.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const ASSET_RE = /^[a-f0-9]{8,40}\.(webp|png|jpe?g)$/;
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function safeEq(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function createServer(opts) {
  const assetsDir = opts.assetsDir;
  const adminKey = opts.adminKey;
  const log = opts.log || (() => {});
  fs.mkdirSync(assetsDir, { recursive: true });

  const cfg = { open: false, password: '', max: 12 };
  let admin = null;
  const players = new Map(); // id -> {ws, id, authed, hello, bucket}
  let seq = 1;
  const servers = [];

  function toAdmin(obj) {
    if (admin && admin.readyState === 1) admin.send(JSON.stringify(obj));
  }
  function sendTo(p, text) {
    if (p.ws.readyState === 1) p.ws.send(text);
  }
  function authedCount() {
    let n = 0;
    for (const p of players.values()) if (p.authed) n++;
    return n;
  }

  /* ---------------- HTTP ---------------- */
  function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let u;
    try { u = new URL(req.url, 'http://local'); } catch (e) { res.writeHead(400); res.end(); return; }
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type' }); res.end(); return; }
    if (u.pathname === '/health' || u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Monolith table server');
      return;
    }
    const k = u.searchParams.get('k') || '';
    const isAdmin = safeEq(k, adminKey);
    if (req.method === 'GET' && u.pathname.startsWith('/asset/')) {
      const id = u.pathname.slice(7);
      if (!ASSET_RE.test(id)) { res.writeHead(404); res.end(); return; }
      if (!isAdmin && !(cfg.open && safeEq(k, cfg.password))) { res.writeHead(403); res.end(); return; }
      const file = path.join(assetsDir, id);
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
        const ext = id.split('.').pop();
        res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400' });
        fs.createReadStream(file).pipe(res);
      });
      return;
    }
    if (req.method === 'POST' && u.pathname === '/upload') {
      if (!isAdmin) { res.writeHead(403); res.end(); return; }
      let ext = (u.searchParams.get('ext') || 'webp').toLowerCase();
      if (!TYPES[ext]) ext = 'webp';
      const chunks = [];
      let size = 0;
      let failed = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > 40 * 1024 * 1024) { failed = true; res.writeHead(413); res.end(); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (failed) return;
        const id = crypto.randomBytes(10).toString('hex') + '.' + ext;
        fs.writeFile(path.join(assetsDir, id), Buffer.concat(chunks), (err) => {
          if (err) { res.writeHead(500); res.end(); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id }));
        });
      });
      return;
    }
    res.writeHead(404); res.end();
  }

  /* ---------------- WebSocket ---------------- */
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

  function onAdmin(ws) {
    if (admin && admin !== ws) { try { admin.close(4002, 'replaced'); } catch (e) {} }
    admin = ws;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const list = [];
    for (const p of players.values()) if (p.authed) list.push({ conn: p.id, msg: p.hello });
    ws.send(JSON.stringify({ ev: 'admin-ok', players: list }));
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (m.ctl === 'config') {
        cfg.open = !!m.open;
        cfg.password = String(m.password || '');
        cfg.max = Math.max(1, Math.min(32, Number(m.max) || 12));
        if (!cfg.open) for (const p of players.values()) { try { p.ws.close(4000, 'closed'); } catch (e) {} }
        return;
      }
      if (m.ctl === 'kick') {
        const p = players.get(m.conn);
        if (p) { sendTo(p, JSON.stringify({ t: 'kicked', reason: String(m.reason || '') })); setTimeout(() => { try { p.ws.close(4003, 'kicked'); } catch (e) {} }, 50); }
        return;
      }
      if (m.to !== undefined && m.msg !== undefined) {
        const text = JSON.stringify(m.msg);
        if (m.to === '*') {
          for (const p of players.values()) if (p.authed && p.id !== m.except) sendTo(p, text);
        } else {
          const ids = Array.isArray(m.to) ? m.to : [m.to];
          for (const id of ids) { const p = players.get(id); if (p && p.authed) sendTo(p, text); }
        }
      }
    });
    ws.on('close', () => {
      if (admin === ws) {
        admin = null;
        for (const p of players.values()) if (p.authed) sendTo(p, JSON.stringify({ t: 'gm-away' }));
      }
    });
  }

  function onPlayer(ws, req) {
    const p = { ws, id: 'c' + (seq++) + crypto.randomBytes(3).toString('hex'), authed: false, hello: null, win: Date.now(), n: 0, strikes: 0 };
    players.set(p.id, p);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const helloTimer = setTimeout(() => { if (!p.authed) try { ws.close(4001, 'no hello'); } catch (e) {} }, 15000);
    const fail = (code, reason) => {
      sendTo(p, JSON.stringify({ t: 'error', code, reason }));
      setTimeout(() => { try { ws.close(4001, code); } catch (e) {} }, 50);
    };
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      // rate limit: 120 messages per 2 seconds
      const now = Date.now();
      if (now - p.win > 2000) { p.win = now; p.n = 0; }
      if (++p.n > 120) { if (p.n === 121 && ++p.strikes > 5) { try { ws.close(4008, 'flood'); } catch (e) {} } return; }
      let m;
      try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (!p.authed) {
        if (m.t !== 'hello') return;
        if (!cfg.open) return fail('closed', 'The GM isn’t hosting a game right now.');
        if (!admin) return fail('gm-offline', 'The GM’s app isn’t connected. Try again in a moment.');
        if (!safeEq(m.password, cfg.password)) return fail('password', 'Wrong room password. Check the invite code with your GM.');
        if (authedCount() >= cfg.max) return fail('full', 'The table is full.');
        p.authed = true;
        p.hello = m;
        clearTimeout(helloTimer);
        toAdmin({ ev: 'join', conn: p.id, msg: m });
        return;
      }
      toAdmin({ ev: 'msg', conn: p.id, msg: m });
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      players.delete(p.id);
      if (p.authed) toAdmin({ ev: 'leave', conn: p.id });
    });
    ws.on('error', () => {});
  }

  wss.on('connection', (ws, req, u) => {
    ws.on('error', () => {});
    if (u.searchParams.get('role') === 'admin') {
      if (!safeEq(u.searchParams.get('k'), adminKey)) { ws.close(4401, 'bad key'); return; }
      onAdmin(ws);
    } else onPlayer(ws, req);
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch (e) {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {}
    }
  }, 25000);

  function attach(server) {
    server.on('request', handler);
    server.on('upgrade', (req, sock, head) => {
      let u;
      try { u = new URL(req.url, 'http://local'); } catch (e) { sock.destroy(); return; }
      if (u.pathname !== '/ws') { sock.destroy(); return; }
      wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req, u));
    });
    servers.push(server);
  }

  function listen(port, host) {
    return new Promise((resolve, reject) => {
      const s = http.createServer();
      attach(s);
      s.once('error', (err) => { servers.splice(servers.indexOf(s), 1); reject(err); });
      s.listen(port, host, () => resolve(s));
    });
  }

  let local = null;
  let pub = null;
  return {
    async start(port = 0, host = '127.0.0.1') {
      try { local = await listen(port, host); }
      catch (e) { local = await listen(0, host); }
      return local.address().port;
    },
    get port() { return local ? local.address().port : 0; },
    async listenPublic(port) {
      if (pub) { await new Promise((r) => pub.close(() => r())); pub = null; }
      pub = await listen(port, '0.0.0.0');
      return pub.address().port;
    },
    async closePublic() {
      if (!pub) return;
      const s = pub; pub = null;
      await new Promise((r) => s.close(() => r()));
    },
    close() {
      clearInterval(beat);
      for (const ws of wss.clients) { try { ws.terminate(); } catch (e) {} }
      for (const s of servers) { try { s.close(); } catch (e) {} }
    },
  };
}

module.exports = { createServer };

// Run standalone for testing: node server.js <port> <assetsDir> <adminKey>
if (require.main === module) {
  const [port = '47020', dir = './test-assets', key = 'devkey'] = process.argv.slice(2);
  const srv = createServer({ assetsDir: dir, adminKey: key, log: console.log });
  srv.start(Number(port)).then((p) => console.log('listening ' + p));
}
