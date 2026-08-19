#!/usr/bin/env bash
# Merge upstream pi-mono into upstream-sync, then into main.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export GIT_HTTP_VERSION="${GIT_HTTP_VERSION:-1.1}"

echo "==> Fetch upstream (badlogic/pi-mono)"
git fetch upstream

CURRENT="$(git branch --show-current)"
if [[ "$CURRENT" != "main" && "$CURRENT" != "upstream-sync" ]]; then
	echo "Switch to main or upstream-sync first (current: $CURRENT)" >&2
	exit 1
fi

echo "==> Update upstream-sync from main"
git checkout upstream-sync 2>/dev/null || git checkout -b upstream-sync main
git merge main --ff-only

echo "==> Merge upstream/main into upstream-sync"
if ! git merge upstream/main -m "merge: sync upstream pi-mono main"; then
	echo
	echo "Conflicts detected. Resolve them, then:"
	echo "  git add <resolved-files>"
	echo "  git commit"
	echo "  git checkout main && git merge upstream-sync"
	echo "  ./scripts/push-sproutai.sh"
	exit 1
fi

echo "==> Merge upstream-sync into main"
git checkout main
git merge upstream-sync --ff-only

echo "==> Install deps and build"
bun install --ignore-scripts
bun run build

echo
echo "Done. Push with: ./scripts/push-sproutai.sh"
echo "Conflict hints:"
echo "  README.md, sproutai patches     -> keep ours"
echo "  bun.lock / root package.json    -> keep ours, then bun install"
echo "  *.generated.ts                  -> take upstream"
