#!/usr/bin/env node
'use strict';
/*
 * Signs release files with the Monolith signing key and writes <file>.sig next to each.
 *   node scripts/sign.js <file>...           key from the MONOLITH_SIGNING_KEY environment variable (PEM text)
 *   node scripts/sign.js --key <pem> <file>  key from a file
 * The same script lives in every Monolith repository.
 */
const fs = require('fs');
const crypto = require('crypto');
const args = process.argv.slice(2);
let pem = process.env.MONOLITH_SIGNING_KEY || '';
const ki = args.indexOf('--key');
if (ki >= 0) { pem = fs.readFileSync(args[ki + 1], 'utf8'); args.splice(ki, 2); }
if (!pem.trim()) { console.error('No signing key: set MONOLITH_SIGNING_KEY or pass --key <file>.'); process.exit(2); }
const key = crypto.createPrivateKey(pem);
if (key.asymmetricKeyType !== 'ed25519') { console.error('The signing key must be an Ed25519 key.'); process.exit(2); }
if (!args.length) { console.error('Nothing to sign.'); process.exit(2); }
for (const f of args) {
  const sig = crypto.sign(null, fs.readFileSync(f), key).toString('base64');
  fs.writeFileSync(f + '.sig', sig + '\n');
  console.log('signed', f);
}
