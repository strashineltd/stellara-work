#!/usr/bin/env bash
# Stellara Work one-line setup script (macOS / Linux)
# Usage: bash setup.sh
set -euo pipefail

echo ">> Checking Node.js..."
node --version || { echo "!! Node.js 20+ required (https://nodejs.org)"; exit 1; }

echo ">> Installing dependencies (better-sqlite3 ships darwin/win32 prebuilds, no compile needed)..."
npm install

echo ">> Running tests..."
npm test || echo "!! Some tests failed. See output above."

echo ""
echo ">> Setup complete!"
echo "   Next steps:"
echo "   1. Fill API key in the app onboarding flow"
echo "   2. Run: npm run dev"
