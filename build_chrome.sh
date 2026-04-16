#!/bin/bash
set -e

OUTDIR=$(mktemp -d)
VERSION=$(node -e "const m=require('./manifest_chrome.json');console.log(m.version)")

# Copy extension files
cp config.js content.js popup.html popup.js "$OUTDIR/"
cp manifest_chrome.json "$OUTDIR/manifest.json"
cp -r icons "$OUTDIR/"

# Build background_sw.js: config.js is loaded via importScripts,
# then a shim maps browser.* to chrome.* (MV3 uses chrome.action, not chrome.browserAction)
cat > "$OUTDIR/background_sw.js" <<'EOF'
importScripts('config.js');

// Chrome MV3 compatibility: map browser.* to chrome.* APIs
const browser = chrome;
browser.browserAction = chrome.action;

EOF
cat background.js >> "$OUTDIR/background_sw.js"

# Pack zip
ZIPNAME="pedalpricer-${VERSION}-chrome.zip"
(cd "$OUTDIR" && zip -r - . --exclude "*.DS_Store") > "$ZIPNAME"
rm -rf "$OUTDIR"

echo "Packed: $ZIPNAME"
