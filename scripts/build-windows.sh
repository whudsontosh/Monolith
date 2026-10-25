#!/usr/bin/env bash
# Builds the Windows installer into ./release. Needs node 20+, python3 and makensis (apt install nsis).
# Works on Linux (GitHub Actions) and WSL.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
echo "Building Monolith $VERSION for Windows"
python3 src/build.py
npm ci --no-audit --no-fund
rm -rf dist-electron release && mkdir -p release
npx electron-builder --win --x64 --dir --publish never
node build/set-exe-icon.mjs "dist-electron/win-unpacked/Monolith.exe" build/icon.ico "$VERSION"
makensis -V2 -DVERSION="$VERSION" -DSRC="../dist-electron/win-unpacked" -DOUTDIR="../release" build/installer.nsi
echo "Done:"; ls -la release
