#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
hook_source="$repo_root/scripts/git-hooks/pre-push"
hook_target="$repo_root/.git/hooks/pre-push"

mkdir -p "$repo_root/.git/hooks"
cp "$hook_source" "$hook_target"
chmod +x "$hook_target"

echo "Git pre-push hook installeret. Direkte push til master bliver nu blokeret lokalt."

