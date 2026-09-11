# TaterMetrics

Small, self-updating sports stats tools — each sport is its own self-contained static site under its own folder (`mlb/`, `nfl/`, `nba/`, `nhl/`), served from one S3 bucket behind one CloudFront distribution. See each sport's own `README.md` for what it does and its own data/build details; this file covers the pieces that span the whole repo — hosting, deploying, and local secrets.

## Structure

```
index.html, style.css   — the "pick a sport" hub page
mlb/, nfl/              — index.html + app.js + style.css + data/, each with its own README.md and scripts/ (Node CLIs used to build/refresh data — not served to visitors)
nba/, nhl/              — index.html only so far
terraform/              — all infrastructure (S3, CloudFront, Route 53, Cloudflare DNS, the daily MLB snapshot Lambda)
scripts/                — repo-wide operational scripts (currently just the Cloudflare cache purge below)
```

## Hosting

One S3 bucket (`tatermetrics.tatertech.net`) behind one CloudFront distribution, answering on three names:

- `tatermetrics.tatertech.net` — Route 53 alias, no Cloudflare involved.
- `tatermetrics.com` / `www.tatermetrics.com` — Cloudflare CNAMEs, **proxied** through Cloudflare's edge (WAF/DDoS protection) rather than DNS-only. See `terraform/cloudflare_dns.tf` for why, and the trade-off that comes with it: Cloudflare independently caches static file extensions (`.js`/`.css`/`.json`/etc.) at its edge for hours, on top of CloudFront's own cache.

All infrastructure is Terraform-managed — see `terraform/`.

## Deploying

No build step anywhere in this repo — every sport folder is static files. The deploy routine is currently manual:

```
aws s3 sync <sport>/ s3://tatermetrics.tatertech.net/<sport>/ --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/<sport>/*"
./scripts/purge-cloudflare-cache.sh
```

The third step matters: because `tatermetrics.com` is proxied through Cloudflare (see above), a CloudFront invalidation alone doesn't clear what Cloudflare itself cached at its edge — visitors on tatermetrics.com can keep seeing stale `app.js`/`style.css`/data files for hours otherwise. `scripts/purge-cloudflare-cache.sh` has the full explanation and usage in its own header comment.

The one exception is MLB's daily standings snapshot, which runs on its own schedule via Lambda + EventBridge — see `mlb/README.md`.

## Local secrets

There are two separate conventions here, for two separate kinds of tooling — mixing them up is an easy way to lose an hour, so worth being explicit:

**Node/bash scripts (`scripts/purge-cloudflare-cache.sh`, `nfl/scripts/snapshot.js`)** read from a **repo-root `.env` file** — already gitignored (`.env` / `*.env` in `.gitignore`) — via a small hand-rolled loader in each script (there's no framework here, just a `KEY=value`-per-line reader). This is NOT something Terraform understands — it's a convention we wrote into these specific scripts, nothing more:

```
CLOUDFLARE_API_TOKEN=your_token_here
CLOUDFLARE_ZONE_ID=your_zone_id_here
```

- `CLOUDFLARE_API_TOKEN` — a Cloudflare token with "Zone > Cache Purge > Purge" permission scoped to the tatermetrics.com zone.
- `CLOUDFLARE_ZONE_ID` — from the Cloudflare dashboard (zone's Overview page, right sidebar under "API") or `terraform output cloudflare_zone_id`.

(`nfl/scripts/snapshot.js` reads its own separate `nfl/.env` for `PARSE_API_KEY` — see `nfl/README.md`.)

**Terraform** never reads `.env` files — it only sees real process environment variables or its own `.tfvars` files. For `cloudflare_api_token` (used by the `cloudflare` provider to authenticate the same way as above, plus broader Zone Read/DNS Edit permissions for managing DNS records), either:

- copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars` (gitignored) and fill in the real token — Terraform loads this automatically, no flags needed; or
- `export CLOUDFLARE_API_TOKEN="..."` in your shell before running any `terraform` command (only lasts that shell session).

If `terraform plan`/`apply` fails with a Cloudflare 403 about missing auth headers, this is almost always why — no token reached Terraform's process environment.

## Where to look next

- `mlb/README.md`, `nfl/README.md` — what each site shows, its data sources, and (for mlb) how to run it locally.
- `terraform/*.tf` — every piece of infrastructure, each file's header comment explains the "why."
