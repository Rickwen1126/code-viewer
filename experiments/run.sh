#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "═══════════════════════════════════════"
echo "  Code Viewer Extension Experiments"
echo "  (with Copilot integration tests)"
echo "═══════════════════════════════════════"

# Step 0: Download Copilot VSIX if not present
VSIX_DIR="$SCRIPT_DIR/third-party-vsix"
COPILOT_VSIX="$VSIX_DIR/GitHub.copilot.vsix"
mkdir -p "$VSIX_DIR"

if [ ! -f "$COPILOT_VSIX" ]; then
  echo ""
  echo "▸ Step 0: Downloading GitHub Copilot VSIX..."
  # Try VS Marketplace download
  if curl -fSL \
    "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/GitHub/vsextensions/copilot/latest/vspackage" \
    -o "$COPILOT_VSIX" 2>/dev/null; then
    echo "  ✓ Copilot VSIX downloaded"
  else
    echo "  ⚠ Auto-download failed."
    echo ""
    echo "  Please download manually:"
    echo "    1. Go to https://marketplace.visualstudio.com/items?itemName=GitHub.copilot"
    echo "    2. Click 'Download Extension' (or use vsixhub.com)"
    echo "    3. Place the .vsix file at:"
    echo "       $COPILOT_VSIX"
    echo ""
    echo "  Or continue without Copilot (experiments 7-8 will report 'not installed')."
    echo ""
    read -p "  Continue without Copilot? [Y/n] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Nn]$ ]]; then
      exit 1
    fi
    # Create a placeholder so Dockerfile COPY doesn't fail
    touch "$VSIX_DIR/.keep"
  fi
else
  echo ""
  echo "▸ Step 0: Copilot VSIX already present, skipping download"
fi

# Step 1: Build the extension
echo ""
echo "▸ Step 1: Building extension..."
cd extension
npm install --cache "$TMPDIR/npm-cache-exp"
npm run esbuild
npm run package
echo "  ✓ Extension VSIX built"
cd "$SCRIPT_DIR"

# Step 1.5: Ensure test-workspace has a git repo for Git API experiment
if [ ! -d "test-workspace/.git" ]; then
  echo ""
  echo "▸ Step 1.5: Initializing git in test-workspace..."
  cd test-workspace
  git init
  git add -A
  git commit -m "initial commit for experiment"
  cd "$SCRIPT_DIR"
  echo "  ✓ Git repo initialized"
fi

# Step 2: Build and start Docker services (clean volumes to pick up new extension)
echo ""
echo "▸ Step 2: Starting Docker services..."
docker compose down -v 2>/dev/null || true
docker compose build --no-cache
docker compose up -d
echo "  ✓ Services started"

# Step 3: Wait for code-server to be ready
echo ""
echo "▸ Step 3: Waiting for code-server..."
for i in $(seq 1 30); do
  if curl -s http://localhost:8080 > /dev/null 2>&1; then
    echo "  ✓ code-server ready (${i}s)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ✗ code-server failed to start"
    docker compose logs code-server
    exit 1
  fi
  sleep 1
done

echo ""
echo "═══════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  code-server: http://localhost:8080"
echo "  test-backend: ws://localhost:9900"
echo ""
echo "  ── Copilot Authentication ──"
echo "  1. Open http://localhost:8080 in browser"
echo "  2. If Copilot is installed, click 'Sign in to GitHub'"
echo "     (bottom-left status bar or notification)"
echo "  3. Copy the device code shown"
echo "  4. Open https://github.com/login/device in another tab"
echo "  5. Enter the code and authorize"
echo ""
echo "  ── Run Experiments ──"
echo "  1. Cmd+Shift+P → 'Code Viewer: Run All Experiments'"
echo "  2. Check 'Code Viewer Experiments' output channel"
echo "  3. Results saved to test-workspace/experiment-results.json"
echo ""
echo "  ── Individual Copilot Experiments ──"
echo "  • 'Code Viewer: Experiment - Copilot Detection'  (#7)"
echo "  • 'Code Viewer: Experiment - Language Model API' (#8)"
echo ""
echo "  To stop:"
echo "    cd experiments && docker compose down"
echo "═══════════════════════════════════════"
