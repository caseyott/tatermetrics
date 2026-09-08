# QB Salary vs. Stats

Is your quarterback overpaid? Every starter-level NFL QB's season stats, lined up against what they were actually paid that same season, then ranked by whether production matches price tag — compared to the field's mean and median.

## What it shows

Three views, toggled by tab:

- **Value Score** — every QB ranked by a composite "value for money" score: how far their pay sits above/below the field's mean (or median) salary, versus how far their production sits above/below the mean (or median) on seven core stats. Positive = paid further above the baseline than production justifies (overpaid); negative = the opposite (underpaid).
- **By Stat** — isolates one stat at a time (e.g. touchdowns): shows each QB's value for that stat, their rank on it, their salary rank, and an overpaid index for that stat alone. This is the literal "the #1 paid QB throws the 2nd-fewest TDs, so by TDs alone he's overpaid by X" comparison.
- **All Stats** — a plain sortable reference table of every stat + salary figure, no judgment applied.

A baseline toggle (Mean / Median) switches what every ratio and index is computed against.

"Starter-level" = at least 8 games played and 224 pass attempts in the season (roughly 14/game) — filters out backups and spot starts while still catching a real starting job that started midseason. All 34 QBs meeting that bar always appear, with stats always real — see "Placeholder salaries" below for what happens when a real salary lookup hasn't happened for one yet.

## Files

- `index.html` — page structure, loads Google Fonts (Roboto Condensed) and Tabler Icons, self-contained styling to match tatertech.net sites
- `style.css` — all styling, same CSS variable tokens as the other TaterMetrics sports pages
- `app.js` — fetches `data/qb.json` and does every calculation client-side (means, medians, ranks, overpaid indices, the composite score) — no backend, no pre-baked numbers
- `data/qb.json` — the data snapshot `app.js` reads. Committed to the repo (not fetched live — see "Why not fetch live" below)
- `data/progress.json` — working state for a resumable `snapshot.js` run (see "Refreshing the data"); auto-deleted once every QB has a confirmed real Spotrac result
- `data/qb-2025.json` — leftover from an earlier version of this pipeline (the abandoned nflverse-contracts-as-primary-source approach); unused, safe to ignore
- `scripts/snapshot.js` — CLI entry point that looks up real salary on Spotrac and builds `data/qb.json` (Node 18+, no deps); needs `PARSE_API_KEY`
- `scripts/refresh-placeholders.js` — rebuilds `data/qb.json` from whatever's already in `data/progress.json`, filling in placeholders for the rest, **without calling Spotrac at all** — use this when credits/quota aren't available (see "Refreshing the data")
- `scripts/lib/qbdata.js` — fetches & filters season stats from nflverse; also fetches the free nflverse-contracts APY estimates used for placeholders
- `scripts/lib/spotrac.js` — looks up real cap-hit salary from Spotrac via a managed API
- `scripts/lib/finalize.js` — shared logic (used by both scripts above) that assembles the final `data/qb.json`: real Spotrac data where confirmed, a placeholder everywhere else

## Data sources

**Stats**: `stats_player_reg_{season}.csv` from the [nflverse-data](https://github.com/nflverse/nflverse-data) GitHub releases (release tag `stats_player`) — one row per player per season, regular season only, sourced from nflverse's public pipeline.

**Salary**: real per-season cap hit from [Spotrac](https://spotrac.com), via a [managed API wrapper on Parse.bot](https://parse.bot/marketplace/7994a459-31cd-4d12-a28b-5c053246f105/spotrac-com-api) (Spotrac has no official public API). Returns the actual year-by-year cap hit — not average-per-year, not a rumored number — so a one-year deal and a back-loaded extension aren't compared apples to oranges.

Both are fetched server-side by `scripts/snapshot.js`, not by `app.js` in the browser: neither source sends CORS headers that would allow a browser fetch, and the Spotrac lookup needs an API key that can't be exposed client-side anyway.

### Why not the nflverse contracts dataset?

nflverse also publishes a `contracts` release (an OverTheCap scrape) that looked like the obvious salary source — no API key needed, single CSV. It turned out to be badly stale for extensions signed after roughly 2022: it had Aaron Rodgers at his old ~$50M/yr Jets APY instead of his real, much smaller 2025 Steelers deal, and Jalen Hurts, Lamar Jackson, and Jordan Love still showing rookie-scale numbers years after their real extensions. It also had no rookie-contract data at all for the 2023+ draft classes (Stroud, Bryce Young, Bo Nix, etc.). Spotrac's per-year cap-hit tables, pulled fresh through the API above, don't have either problem.

### Same-year mapping

Stats and salary are deliberately matched to the *same* season — what a QB earned during the year those stats were produced — not stats-this-year-vs-salary-next-year. As of this build, the current season hadn't started yet, so both are the most recently completed season.

### Placeholder salaries

Real salary comes from Spotrac one QB at a time, and that lookup is rate-limited (see "Free-tier limits" below) — so at any given moment, some starters may not have a confirmed real cap hit yet. Rather than hide those QBs, every starter always appears with a salary figure, tiered by confidence:

1. **Real** (`salary.source: "spotrac_cap_hit"` or `"spotrac_cash_approx"`) — a confirmed Spotrac lookup. No marker on the page.
2. **Estimate** (`"nflverse_apy_estimate"`) — that QB's current-contract APY from the free nflverse `contracts` dataset (the one described above as too stale to be the *primary* source). Still real, sourced data — just not necessarily current. Shown with a `~` marker.
3. **Flat placeholder** (`"placeholder_flat"`) — no data found in either source at all (typically a 2023+ rookie contract missing from the nflverse scrape too). A generic $2,000,000 stand-in, not researched. Shown with a `?` marker.

Every QB's `salary.isPlaceholder` flag (tiers 2 and 3) and the top-level `salaryPending` list (everyone not yet confirmed real) tell `app.js` who still needs a real lookup — that list is also what drives the in-progress banner and the "QBs still showing a placeholder salary" section on the page. Rankings use whatever figure is currently shown, so Value Score / By Stat results involving a tier-2 or tier-3 QB will shift once a real number replaces the placeholder — expected, not a bug.

## Methodology

**Core stats in the Value Score** (equal-weighted): completion %, passing yards, total TDs (passing + rushing), interceptions, passer rating, TD:INT ratio, sacks taken. Passer rating is computed client-side with the standard NFL formula from completions/attempts/yards/TDs/INTs — nothing pre-computed in the data file.

**Overpaid index (per stat)** = (salary ratio vs. baseline) − (stat ratio vs. baseline), where each ratio is `(value − baseline) / baseline`, sign-flipped for "lower is better" stats (INTs, sacks) so a positive ratio always means "better than baseline." A positive index means pay outpaces production relative to the field; negative means the opposite.

**Value Score** = the average overpaid index across the seven core stats.

**Verdict thresholds** (±0.15) are a judgment call, not a statistical cutoff — "Fair Value" is a band, not a precise zero point.

## Known limitations

- **Sacks taken** is included as a "lower is better" QB stat, but it's heavily influenced by the offensive line, not just the QB. It's one input among seven, not a standalone judgment.
- **Placeholder-tier salaries skew rankings** — a QB on a $2M flat placeholder will look artificially "underpaid" next to his real stats, and a stale nflverse APY estimate can be meaningfully off in either direction. The page flags every non-real figure (see "Placeholder salaries" above); treat Value Score / By Stat results involving a flagged QB as provisional.
- **Spotrac scrape reliability under sustained load**: a single isolated lookup is reliably correct, but making many rapid automated calls back-to-back in one run has, in testing, produced "success" responses with wrong data — several definitely-under-contract veterans (Dak Prescott, Jalen Hurts, Joe Burrow, Lamar Jackson) briefly came back tagged "free agent" or "not found," then resolved correctly seconds later on an isolated re-check. `scripts/snapshot.js` now auto-retries those two specific outcomes (`not_found_on_spotrac`, `not_under_contract_that_year`) once, with a 10s pause, before accepting them — but if a refresh still produces a suspicious wave of either for known starters, spot-check a few by hand before trusting the batch.
- **`no_salary_data_for_year` is NOT retried** — verified directly against Matthew Stafford's raw Spotrac data that this is a real, stable gap (he signed a newer deal, and Spotrac doesn't retain a Cap Hit breakdown for the superseded contract), not a transient glitch. Retrying it just re-confirms the same absence at full price — this was most of what burned through a month's credits pulling only 12 QBs in one earlier run. `fetchQbCapHit` tries a cash-paid fallback for these cases before giving up entirely (see below); only a genuine double-miss gets this label.
- **Approximate salary fallback**: when no Cap Hit table covers the target year, `lib/spotrac.js` falls back to that season's row in the player's "Earnings Per Year" table — real cash paid that year, not the accounting cap-hit figure. These show with `salary.isApprox: true` in the data and a "≈" marker + tooltip on the page. Not a full substitute (no cap-% figure comes with it), but better than dropping the player entirely.
- **Free-tier limits**: 5 req/min, 100 req/day, 200 credits/month, ~2 requests per QB (more for the handful that hit a retry). A full 34-QB refresh may need to span more than one day, and — as happened once already — can burn a full month's credit allowance before finishing if too many QBs hit genuine data gaps. `scripts/snapshot.js` is resumable (see below) specifically because of this.
- **Contract edge cases**: a QB who's a free agent, retired, or between contracts for the target year is excluded (`not_under_contract_that_year`) rather than shown with a misleading number.

## Refreshing the data

**With Spotrac quota available** — looks up real salary for every QB not already confirmed, then rebuilds `data/qb.json` (placeholders included for anyone still unconfirmed):

```
cd nfl/scripts
node snapshot.js
```

Requires `PARSE_API_KEY` in `nfl/.env` (gitignored — never commit it):

```
PARSE_API_KEY=your_key_here
```

The script is **resumable**: progress is saved to `data/progress.json` after every single QB looked up, so if it's interrupted — or stops on purpose because Spotrac's daily quota or monthly credits ran out — just re-run it later and it picks up exactly where it left off, without re-paying for QBs already resolved. `data/progress.json` is deleted automatically once every QB has a confirmed real result. Delete it manually to force a full re-run.

**Without Spotrac quota** (credits exhausted, or you just don't want to spend any) — rebuilds `data/qb.json` from whatever's already confirmed in `data/progress.json`, filling in a placeholder for everyone else, using only free data sources:

```
cd nfl/scripts
node refresh-placeholders.js
```

No API key needed, makes zero Spotrac calls. Safe to run any time — e.g. right after a fresh nflverse stats release, so the site shows updated stats immediately even if salary lookups have to wait.

**Status as of this writing**: all 34 starter QBs have real 2025 stats loaded. 4 have a confirmed real Spotrac salary (Dak Prescott, Josh Allen, Jalen Hurts, Bo Nix); the other 30 are showing a placeholder (mostly tier-2 nflverse APY estimates, 10 tier-3 flat placeholders for recent rookies missing from that dataset too — see "Placeholder salaries" above). The free-tier monthly credit allowance ran out mid-run; expected to refresh in September, at which point `node snapshot.js` will pick up the remaining 30.

This data only changes when a contract is signed/restructured or a new season's stats go final — not daily — so unlike some of the other TaterMetrics pages, there's no scheduled Lambda for this one. Re-run manually after a big trade/extension, or once next season's stats are underway.

## Deploying

Static files, no build step. Drop this whole `nfl/` folder anywhere it can be served over HTTP(S) — e.g. as a path under `tatermetrics.tatertech.net/nfl/`. `data/qb.json` needs to be current (see above) since, unlike the mlb page, this one doesn't hit a live API on every page load.
