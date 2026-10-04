#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build

docker compose --env-file ops/.env.production -f ops/compose.production.yml config >/dev/null
