# MLB Magic Numbers

A live, self-updating recreation of [playoffmagic.com](https://www.playoffmagic.com/mlb/league/)'s MLB standings/magic-number grids — built because that site's data had gone stale. This one pulls straight from the official MLB Stats API on every page load, so it's never out of date.

## What it shows

Two views, toggled by tab:

- **League Standings** — all 15 teams per league, ordered the way MLB actually seeds a wild-card race: the 3 division leaders first (East, Central, West), then the top 3 wild-card contenders, then everyone else by record.
- **Division Standings** — the six 5-team divisions, each with its own head-to-head grid.

Each table shows record, games played/remaining, win%, games back (and wild-card games back on the league view), plus a full grid of pairwise **magic numbers**: the combined wins (row team) + losses (column team) needed for the row team to guarantee finishing ahead of that specific column team. Cells show `NC` ("not clinched") when the column team currently has the better record. Rows are tinted to flag a team that's clinched its division, clinched a wild card, or been eliminated.

Magic number cells are also flagged when they've dropped since the previous day: a single &#9660; for down 1, a double &#9660;&#9660; (with a stronger highlight) for down 2 or more — the latter usually means a doubleheader sweep, or that the rival lost twice in one day.

## Files

- `index.html` — page structure, loads Google Fonts (Roboto Condensed) and Tabler Icons to match the styling used on [curling.tatertech.net](https://curling.tatertech.net)
- `style.css` — all styling, using the same CSS variable tokens (colors, spacing, table conventions) as the curling scorekeeper site for a consistent look across tatertech.net properties
- `app.js` — fetches and computes everything client-side; no backend or build step
- `scripts/snapshot.js` — daily cron job (Node 18+, no deps) that writes the previous-day wins/losses snapshot `app.js` diffs against

## Day-over-day snapshots

`app.js` itself has no backend or memory — every page load starts fresh from the live MLB Stats API. To flag magic numbers that changed since yesterday, a separate daily job writes a tiny snapshot of every team's wins/losses to S3, dated by the US-Eastern "baseball day":

```
s3://tatermetrics.tatertech.net/mlb/data/YYYY-MM-DD.json
```

`.github/workflows/mlb-snapshot.yml` runs `scripts/snapshot.js` once a day (09:15 UTC — after all games, including West Coast doubleheaders, should be final), then uploads the result using the same GitHub Actions OIDC deploy role already set up in `terraform/modules/github_oidc`. On the next page load, `app.js` fetches yesterday's file (falling back up to 4 days if one's missing) and re-derives what each pairwise magic number *was* as of that snapshot, since the formula only depends on wins/losses.

Requires two repo-level Actions variables (Settings → Actions → Variables), both already surfaced as terraform outputs:

- `AWS_ROLE_ARN` = `terraform output github_oidc_deploy_role_arn`
- `CF_DISTRIBUTION_ID` = `terraform output cloudfront_distribution_id`

## Data source

[MLB Stats API](https://statsapi.mlb.com) (`statsapi.mlb.com`), unauthenticated, CORS-open:

- `/api/v1/standings?leagueId=103,104&standingsTypes=regularSeason` — division standings, elimination numbers, clinch flags
- `/api/v1/standings?leagueId=103,104&standingsTypes=wildCard` — wild-card rank and games-back

The season defaults to whatever MLB considers current, so no yearly code change is needed.

Magic numbers are computed locally using the standard formula: `163 − (row team's wins) − (column team's losses)`, based on a 162-game season. Division/wild-card names, IDs, and team abbreviations are hardcoded in `app.js` since the standings endpoint doesn't return division display names.

## Deploying

Static files, no build step. Drop this whole `mlb/` folder anywhere it can be served over HTTP(S) — e.g. as a path under `tatermetrics.tatertech.net/mlb/`. Nothing needs to be run server-side; every page load fetches fresh data from MLB directly in the browser.

## Known limitations

- Ties in record are broken by wins/losses only (no head-to-head or division-record tiebreakers), so genuinely tied teams show `NC` against each other until one pulls ahead.
- Assumes a standard 162-game season for the magic-number formula; this can be slightly off in a season with unusual makeup-game totals.
