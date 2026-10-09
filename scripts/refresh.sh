#!/usr/bin/env bash
# ==============================================================================
# resume-gen: Lightweight Pull-to-Refresh Deployment Script for OCI Host
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${APP_DIR}"

echo "============================================================"
echo " [resume-gen] Pull-to-Refresh Deployment"
echo " Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo " Location: ${APP_DIR}"
echo "============================================================"

# 1. Fetch latest changes from main branch
echo "--> 1. Fetching latest Git commits from origin/main..."
git fetch origin main
git reset --hard origin/main
CURRENT_REV="$(git rev-parse --short HEAD)"
echo "    Synced to revision: ${CURRENT_REV}"

# 2. Synchronize dependencies
echo "--> 2. Ensuring Node.js dependencies are up to date..."
npm install --no-audit --no-fund

# 3. Ensure Playwright Chromium binary is available
echo "--> 3. Verifying Playwright Chromium headless binary..."
npx playwright install chromium

# 4. Typecheck TypeScript codebase
echo "--> 4. Typechecking application code..."
npm run typecheck

# 5. Restart systemd supervisor unit if available
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet resume-gen.service 2>/dev/null; then
    echo "--> 5. Restarting systemd service (resume-gen.service)..."
    sudo systemctl restart resume-gen.service
    sleep 2
else
    echo "--> 5. Note: systemd service not active or running in non-systemd environment. Skipping systemctl restart."
fi

# 6. Verify health check
echo "--> 6. Verifying loopback health endpoint (127.0.0.1:3000/api/health)..."
if command -v curl >/dev/null 2>&1; then
    if curl -fsSL http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
        echo "    ✓ Health check PASSED: Server is alive on 127.0.0.1:3000"
    else
        echo "    ! Notice: Health check not yet responding (server may be managed independently or starting up)."
    fi
fi

echo "============================================================"
echo " [resume-gen] Deployment complete for commit ${CURRENT_REV}"
echo "============================================================"
