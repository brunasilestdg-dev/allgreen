#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-brunasilestdg-dev/allgreen}"
BRANCH="${BRANCH:-main}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) não encontrado." >&2
  exit 1
fi

gh auth status >/dev/null

echo "Protegendo ${REPO}:${BRANCH}..."
gh api   --method PUT   -H "Accept: application/vnd.github+json"   -H "X-GitHub-Api-Version: 2022-11-28"   "/repos/${REPO}/branches/${BRANCH}/protection"   --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON

echo
echo "Proteção aplicada. Estado atual:"
gh api   -H "Accept: application/vnd.github+json"   -H "X-GitHub-Api-Version: 2022-11-28"   "/repos/${REPO}/branches/${BRANCH}/protection"
