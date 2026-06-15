#!/usr/bin/env bash
# Deploy helper for todo — one command, concise output (build runs inside the Dockerfile).
# Usage: ./deploy.sh        rebuild + restart via docker compose, then health-check :3051
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

step "docker compose up -d --build (todo)"
docker compose up -d --build

step "Health check (http://127.0.0.1:3051)"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3051" || echo 000)
case "$code" in
  200|301|302) ok "todo responding ($code)" ;;
  *) printf '\033[1;31m✗ %s → %s (check: docker compose logs --tail 50)\033[0m\n' "todo" "$code" ;;
esac

printf '\n\033[1;32m✓ Deploy done.\033[0m\n'
