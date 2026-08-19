#!/usr/bin/env bash
# Push main (and upstream-sync if present) to GitHub and Gitea.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export GIT_HTTP_VERSION="${GIT_HTTP_VERSION:-1.1}"

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
	echo "Checkout main before pushing (current: $BRANCH)" >&2
	exit 1
fi

echo "==> Push main -> origin (GitHub)"
git push origin main

if git show-ref --verify --quiet refs/heads/upstream-sync; then
	echo "==> Push upstream-sync -> origin"
	git push origin upstream-sync
fi

if git remote get-url gitea &>/dev/null; then
	echo "==> Push main -> gitea"
	git push gitea main
	if git show-ref --verify --quiet refs/heads/upstream-sync; then
		git push gitea upstream-sync
	fi
fi

echo "Done."
