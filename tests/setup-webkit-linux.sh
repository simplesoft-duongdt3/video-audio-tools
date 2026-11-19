#!/usr/bin/env bash
# Makes Playwright's WebKit (the iPhone/Safari engine) run on Linux WITHOUT sudo:
# downloads the few missing system libraries as .deb files and unpacks them into
# WebKit's own bundled lib folder inside ~/.cache/ms-playwright (nothing system-wide is touched).
# With sudo you can instead run: sudo npx playwright install-deps webkit
set -euo pipefail
cd "$(dirname "$0")"
npx playwright install webkit
WK=$(ls -d ~/.cache/ms-playwright/webkit-* | sort | tail -1)/minibrowser-wpe/sys/lib
TMP=.webkit-libs
mkdir -p "$TMP/debs" && cd "$TMP/debs"
apt-get download libevent-2.1-7t64 libavif16 libmanette-0.2-0 libyuv0 libgav1-2 libbacktrace0 libhidapi-hidraw0
for f in *.deb; do dpkg -x "$f" ../root; done
cp -a ../root/usr/lib/x86_64-linux-gnu/*.so* "$WK/"
echo "WebKit libs installed into $WK"
