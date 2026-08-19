#!/usr/bin/env bash
# Create a feature branch from latest main.
set -euo pipefail

if [[ $# -lt 1 ]]; then
	echo "Usage: $0 <feature-name>" >&2
	echo "Example: $0 webui-avatar-fix" >&2
	exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="$1"
BRANCH="feature/$NAME"

git checkout main
git pull --ff-only origin main 2>/dev/null || true
git checkout -b "$BRANCH"

echo "Created and switched to $BRANCH"
