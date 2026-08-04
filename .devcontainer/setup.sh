#!/usr/bin/env bash
# Provisions the dev container. Runs once, after the container is created.
set -euo pipefail

echo "==> Installing system packages"
sudo apt-get update -qq

# Chromium plus the Japanese fonts it needs to render the store screenshots.
# Puppeteer publishes no linux/arm64 Chromium build, so scripts/build-screenshots.mjs
# uses the distro binary on every architecture.
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  chromium \
  fonts-noto-cjk \
  zip

sudo rm -rf /var/lib/apt/lists/*

echo "==> Installing npm dependencies"
npm install

echo
echo "Ready. Useful commands:"
echo "  npm run build:dict        compile JMdict (needs network, a few minutes)"
echo "  npm run release           icons + dictionary + bundle + tests + zip"
echo "  npm run dev               rebuild on change; load dist/ as an unpacked extension"
