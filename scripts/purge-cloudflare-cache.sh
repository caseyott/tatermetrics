#!/usr/bin/env bash
#
# scripts/purge-cloudflare-cache.sh
#
# Purges the Cloudflare edge cache for tatermetrics.com / www.tatermetrics.com.
#
# Why this is needed: tatermetrics.com is proxied through Cloudflare (see
# terraform/cloudflare_dns.tf), so Cloudflare's edge sits in front of
# CloudFront and independently caches static file extensions (.js, .css,
# .json, etc.) for hours by default. A `aws cloudfront create-invalidation`
# only clears CloudFront's own cache — it does nothing to Cloudflare's, so
# visitors on tatermetrics.com can keep seeing stale files for hours after a
# deploy that already invalidated CloudFront. Run this script as the last
# step of every deploy that touches app.js/index.html/style.css/data files,
# right after the S3 sync + CloudFront invalidation:
#
#   aws s3 sync <sport>/ s3://tatermetrics.tatertech.net/<sport>/ ...
#   aws cloudfront create-invalidation --distribution-id <id> --paths "/<sport>/*"
#   ./scripts/purge-cloudflare-cache.sh
#
# Requires two env vars, either exported in your shell or set in a repo-root
# `.env` file (gitignored, same convention as nfl/.env — see README.md):
#   CLOUDFLARE_API_TOKEN - a token with "Zone > Cache Purge > Purge" permission
#     scoped to the tatermetrics.com zone (the same token used as
#     TF_VAR_cloudflare_api_token for terraform)
#   CLOUDFLARE_ZONE_ID   - from `terraform output cloudflare_zone_id` (run
#     inside terraform/)
#
# Usage:
#   ./scripts/purge-cloudflare-cache.sh                  # purge everything (default)
#   ./scripts/purge-cloudflare-cache.sh <url> [url...]   # purge just these URLs
#                                                          # (full URLs, e.g.
#                                                          # https://tatermetrics.com/mlb/app.js)

set -euo pipefail

# Load repo-root .env if present, without overriding anything already
# exported in the shell (same precedence as nfl/scripts/snapshot.js's loader).
env_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
if [ -f "$env_file" ]; then
  while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    case "$key" in \#*) continue ;; esac
    if [ -z "${!key:-}" ]; then
      export "$key=$value"
    fi
  done <"$env_file"
fi

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN — a token with Cache Purge permission on the tatermetrics.com zone (in your shell, or in a repo-root .env file)}"
: "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID — run \`terraform output cloudflare_zone_id\` inside terraform/ (in your shell, or in a repo-root .env file)}"

if [ "$#" -eq 0 ]; then
  echo "Purging entire Cloudflare cache for zone ${CLOUDFLARE_ZONE_ID}..."
  body='{"purge_everything":true}'
else
  echo "Purging $# specific URL(s) from Cloudflare cache..."
  files_json=$(printf '"%s",' "$@" | sed 's/,$//')
  body="{\"files\":[${files_json}]}"
fi

response=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "${body}")

echo "${response}"

if echo "${response}" | grep -q '"success":true'; then
  echo "Cloudflare cache purge succeeded."
else
  echo "Cloudflare cache purge FAILED — see response above." >&2
  exit 1
fi
