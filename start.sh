#!/usr/bin/env bash
# VEXO launcher for Linux / macOS (same steps as Start.bat).
set -euo pipefail
cd "$(dirname "$0")"

# --- Node.js 22.13+ is required for the built-in SQLite module ---
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found."
  echo "Install Node.js 22 LTS or newer (https://nodejs.org, your package manager, or nvm) and run ./start.sh again."
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "Node.js $(node -v) is too old: VEXO needs 22.13 or newer."
  exit 1
fi

# --- First run: install dependencies ---
if [ ! -d node_modules ]; then
  echo "Installing dependencies, this takes a minute the first time..."
  npm install-scripts approve esbuild sharp >/dev/null 2>&1 || true
  npm install || { echo "Dependency install failed."; exit 1; }
fi

# --- Browser: Edge or Chrome if installed, else Playwright's own Chromium ---
has_browser() {
  for b in microsoft-edge microsoft-edge-stable google-chrome google-chrome-stable; do
    command -v "$b" >/dev/null 2>&1 && return 0
  done
  [ -d "/Applications/Microsoft Edge.app" ] || [ -d "/Applications/Google Chrome.app" ]
}
if [ -z "${VEXO_BROWSER:-}" ] && ! has_browser; then
  if ! ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" 2>/dev/null | grep -q '^chromium-'; then
    echo "Neither Edge nor Chrome found: downloading Chromium for Playwright (once)..."
    npx playwright install chromium || { echo "Chromium download failed. Install Google Chrome or Microsoft Edge instead."; exit 1; }
  fi
fi

echo "Building the interface..."
npm run build >/dev/null || { echo "Build failed."; exit 1; }

URL=http://127.0.0.1:3210
# open the browser once the server answers
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "$URL" 2>/dev/null; then break; fi
    sleep 0.5
  done
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "$URL"
  fi
) &

echo
echo "  VEXO is running on $URL"
echo "  Press Ctrl+C to stop it."
echo
exec npm run start
