#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch_root="$(mktemp -d "${TMPDIR:-/tmp}/docker-context-check.XXXXXX")"
context_dir="$scratch_root/context"
export_dir="$scratch_root/exported"

cleanup() {
  case "$scratch_root" in
    "${TMPDIR:-/tmp}"/docker-context-check.*) rm -rf -- "$scratch_root" ;;
    *) printf 'Refusing to remove unexpected path: %s\n' "$scratch_root" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$context_dir/ops" "$context_dir/deep/nested" "$export_dir"
cp "$repo_root/.dockerignore" "$context_dir/.dockerignore"
printf '%s\n' 'FROM scratch' 'COPY . /probe/' > "$context_dir/Dockerfile"
printf '%s\n' 'synthetic-ordinary-marker' > "$context_dir/ordinary.txt"
printf '%s\n' 'synthetic-root-env' > "$context_dir/.env.production"
printf '%s\n' 'synthetic-ops-env' > "$context_dir/ops/.env.production"
printf '%s\n' 'synthetic-deep-env' > "$context_dir/deep/nested/.env.local"

docker build --progress=plain \
  --output "type=local,dest=$export_dir" \
  "$context_dir"

grep -qx 'synthetic-ordinary-marker' "$export_dir/probe/ordinary.txt"

leaked=0
for env_file in .env.production ops/.env.production deep/nested/.env.local; do
  if test -e "$export_dir/probe/$env_file"; then
    printf 'Synthetic env leaked into Docker output: %s\n' "$env_file" >&2
    leaked=1
  fi
done

if test "$leaked" -ne 0; then
  exit 1
fi

printf '%s\n' 'Docker context check passed: ordinary marker copied; synthetic env files excluded.'
