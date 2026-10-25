#!/usr/bin/env bash
# Release check on a real Mac (GitHub's macOS runner): the packaged app starts on the game shelf,
# its table server answers, it can go online through Cloudflare, and the self-updater accepts a
# signed update, swaps the app and reopens it. The update is signed with the real signing key
# (MONOLITH_SIGNING_KEY), because an installed app trusts no other.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION=$(node -p "require('./package.json').version")
ZIP="$ROOT/release-mac/Monolith-$VERSION-mac.zip"
WORK="$(mktemp -d)"
APPS="$WORK/Applications"; mkdir -p "$APPS"
ditto -x -k "$ZIP" "$APPS"
APP="$APPS/Monolith.app"
BIN="$APP/Contents/MacOS/Monolith"
report() { # also surface details as a build annotation (readable without the full log)
  local body; body="$( { echo "$1"; for f in "$WORK"/*.json "$WORK"/*.after "$WORK"/*.log; do [ -f "$f" ] && { echo "--- $(basename "$f")"; tail -c 1500 "$f"; }; done; cat "$TMPDIR"/Monolith-update/mac-update.log 2>/dev/null | tail -c 800; } )"
  body="${body//'%'/'%25'}"; body="${body//$'\r'/'%0D'}"; body="${body//$'\n'/'%0A'}"
  echo "::$2 title=Mac check::${body:0:6000}"; }
fail() { echo "SMOKE FAIL: $*"; report "FAIL: $*" error; exit 1; }
wait_for() { for i in $(seq 1 "$2"); do [ -f "$1" ] && grep -q '"finished": true' "$1" && return 0; sleep 1; done; return 1; }

echo "== 1. starts on the game shelf, serves the table, goes online"
MONOLITH_SMOKE_TUNNEL=1 "$BIN" --monolith-smoke-out="$WORK/run1.json" > "$WORK/run1.log" 2>&1 &
wait_for "$WORK/run1.json" 150 || fail "first launch didn't finish"
cat "$WORK/run1.json"
grep -q '"ok": true' "$WORK/run1.json" || fail "first launch reported a problem"
grep -q '"page": "launcher.html"' "$WORK/run1.json" || fail "didn't open on the game shelf"
grep -q '"serverStatus": 200' "$WORK/run1.json" || fail "table server didn't answer"
grep -q '"tunnelStatus": 200' "$WORK/run1.json" || echo "::warning::Cloudflare link didn't answer from the runner (network); not failing the build"
sleep 2

if [ -z "${MONOLITH_SIGNING_KEY:-}" ]; then echo "::warning::No signing key in this run; skipping the self-update check"; report "OK (no update check)" notice; exit 0; fi
echo "== 2. a signed self-update swaps the app and reopens it"
SRV="$WORK/srv"; mkdir -p "$SRV/v$VERSION"
cp "$ZIP" "$SRV/v$VERSION/"
SHA=$(shasum -a 256 "$ZIP" | cut -d' ' -f1); SIZE=$(stat -f%z "$ZIP"); NAME=$(basename "$ZIP")
cat > "$SRV/latest.json" <<JSON
{"format":"monolith-update","version":"$VERSION","platforms":{"darwin":{"file":"$NAME","url":"http://127.0.0.1:8765/v$VERSION/$NAME","sha256":"$SHA","size":$SIZE}}}
JSON
node scripts/sign.js "$SRV/latest.json"
(cd "$SRV" && python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1) &
HTTP=$!
sleep 1
BEFORE=$(stat -f%i "$APP")
MONOLITH_UPDATE_URL="http://127.0.0.1:8765/latest.json" MONOLITH_UPDATE_ASSET_PREFIX="http://127.0.0.1:8765/" MONOLITH_UPDATE_PRETEND_VERSION="0.0.1" \
  "$BIN" --monolith-smoke-out="$WORK/run2.json" > "$WORK/run2.log" 2>&1 &
for i in $(seq 1 120); do grep -q '"update": "handed-off"' "$WORK/run2.json" 2>/dev/null && break; grep -q '"finished": true' "$WORK/run2.json" 2>/dev/null && break; sleep 1; done
cat "$WORK/run2.json" || true
grep -q '"update": "handed-off"' "$WORK/run2.json" || fail "the updater didn't hand off to the installer helper"
wait_for "$WORK/run2.json.after" 90 || fail "the app didn't reopen after updating"
cat "$WORK/run2.json.after"
AFTER=$(stat -f%i "$APP")
[ "$BEFORE" != "$AFTER" ] || fail "the app bundle wasn't replaced"
ls -a "$APPS" | grep -q '^\.monolith-' && fail "leftover update folders"
codesign --verify --deep --strict "$APP" || fail "updated app isn't validly signed"
echo "== 3. an unsigned update is refused"
echo "tampered" > "$SRV/latest.json.sig"
MONOLITH_UPDATE_URL="http://127.0.0.1:8765/latest.json" MONOLITH_UPDATE_ASSET_PREFIX="http://127.0.0.1:8765/" MONOLITH_UPDATE_PRETEND_VERSION="0.0.1" \
  "$BIN" --monolith-smoke-out="$WORK/run3.json" > "$WORK/run3.log" 2>&1 &
wait_for "$WORK/run3.json" 90 || fail "third launch didn't finish"
cat "$WORK/run3.json"
grep -q 'signed with Monolith' "$WORK/run3.json" || fail "an update without a valid signature wasn't refused"
kill $HTTP 2>/dev/null || true
report "OK" notice
echo "SMOKE OK"
