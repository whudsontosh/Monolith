#!/usr/bin/env bash
# Builds the Mac app (one universal build for Apple Silicon and Intel) into ./release-mac:
#   Monolith-<version>.dmg      what people download and drag to Applications
#   Monolith-<version>-mac.zip  what the app's self-updater downloads
# Needs macOS with Xcode command line tools, node 20+ and python3. The app is ad-hoc signed
# (not notarised), so on first launch macOS asks people to allow it in Privacy & Security.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
echo "Building Monolith $VERSION for macOS"
python3 src/build.py
npm ci --no-audit --no-fund
rm -rf dist-electron release-mac
npx electron-builder --mac --universal --dir --publish never
APP="$(ls -d dist-electron/mac-universal/*.app | head -n1)"
[ -d "$APP" ] || { echo "no .app produced"; exit 1; }
# Apple Silicon only runs signed code: re-sign the whole bundle ad hoc after electron-builder's changes
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
lipo -archs "$APP/Contents/MacOS/Monolith"
mkdir -p release-mac
ZIP="release-mac/Monolith-$VERSION-mac.zip"
DMG="release-mac/Monolith-$VERSION.dmg"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
STAGE="$(mktemp -d)"
ditto "$APP" "$STAGE/Monolith.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Monolith $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG"
rm -rf "$STAGE"
echo "Done:"; ls -la release-mac
