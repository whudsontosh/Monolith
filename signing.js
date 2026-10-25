'use strict';
/*
 * Monolith's signing check. Every game release and every Monolith update comes with a signature
 * made by the publisher's private key; the matching public key below is built into the app.
 * A file that doesn't verify against it is never installed or run, even if it came from the
 * right GitHub repository.
 *
 * Key fingerprint (SHA-256 of the public key, first 16 hex): 3b01cb1cfef8ad7c
 */
const crypto = require('crypto');

const PUBLIC_KEYS = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAFM73TG8K7rsGYbjG9/IqCxNSRnIkSrqn1kW/aH9xoLs=
-----END PUBLIC KEY-----`,
];
let keys = null;
/* tests only: a developer copy (never the installed app) can trust an extra key */
function addTestKey(pem) { PUBLIC_KEYS.push(String(pem)); keys = null; }
function keyObjects() { if (!keys) keys = PUBLIC_KEYS.map((k) => crypto.createPublicKey(k)); return keys; }

/** true when `sig` (base64) is a valid signature of `data` (Buffer or string) by a Monolith key */
function verify(data, sig) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  let s;
  try { s = Buffer.from(String(sig || '').trim(), 'base64'); } catch (e) { return false; }
  if (s.length !== 64) return false;
  for (const k of keyObjects()) { try { if (crypto.verify(null, buf, k, s)) return true; } catch (e) {} }
  return false;
}
function fingerprint() { return crypto.createHash('sha256').update(keyObjects()[0].export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16); }

module.exports = { verify, fingerprint, addTestKey };
