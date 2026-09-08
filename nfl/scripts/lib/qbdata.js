/**
 * 2025-season QB stats fetch (nflverse).
 *
 * Salary now comes from Spotrac via ./spotrac.js, not from nflverse's own
 * "contracts" release — that dataset turned out to be stale for most
 * extensions signed after ~2022 (see README.md), so it's no longer used.
 *
 * Data source: stats_player_reg_2025.csv (nflverse-data release tag
 * "stats_player") — one row per player per season, regular season only.
 * 2025 is the most recently completed NFL season (the 2026 season hadn't
 * started as of this snapshot).
 *
 * Served from GitHub's release-asset redirect
 * (release-assets.githubusercontent.com), which does NOT send
 * Access-Control-Allow-Origin — so this fetch cannot happen from a
 * browser. That's why this lives in a Node script rather than app.js:
 * app.js reads the joined, static JSON this script writes.
 */

const STATS_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2025.csv";

const SEASON = 2025;
const MIN_GAMES = 8;
const MIN_ATTEMPTS = 224; // ~14/game — filters backups/spot starters, keeps real starters

/** Parses a single CSV line respecting double-quoted fields (RFC 4180-ish). */
function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** Parses a full CSV string (with a header row) into an array of row objects. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function toNum(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetches the 2025 season stats file and returns starter-level QBs
 * (8+ games, 224+ attempts), raw — no salary attached yet.
 */
async function fetchStarterQbStats() {
  const res = await fetch(STATS_URL);
  if (!res.ok) throw new Error(`stats fetch failed: ${res.status}`);
  const text = await res.text();

  const rows = parseCsv(text).filter(
    (r) =>
      r.position === "QB" &&
      r.season_type === "REG" &&
      toNum(r.games) >= MIN_GAMES &&
      toNum(r.attempts) >= MIN_ATTEMPTS
  );

  return rows.map((s) => ({
    name: s.player_display_name,
    team: s.recent_team,
    stats: {
      games: toNum(s.games),
      completions: toNum(s.completions),
      attempts: toNum(s.attempts),
      passingYards: toNum(s.passing_yards),
      passingTds: toNum(s.passing_tds),
      interceptions: toNum(s.passing_interceptions),
      sacks: toNum(s.sacks_suffered),
      rushingYards: toNum(s.rushing_yards),
      rushingTds: toNum(s.rushing_tds),
    },
  }));
}

// Only shipped gzip-compressed for this release — no plain .csv asset.
const CONTRACTS_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.csv.gz";

// nflverse's stats file uses full/legal names that don't always match the
// OTC-sourced contracts file's naming (nicknames, suffixes).
const NAME_OVERRIDES = {
  "matthew stafford": "matt stafford",
};

function normalizeName(name) {
  let n = name.trim().toLowerCase();
  n = n.replace(/[.'’]/g, "");
  n = n.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "");
  n = n.replace(/\s+/g, " ");
  return NAME_OVERRIDES[n] || n;
}

/**
 * Fetches nflverse's `contracts` release (an OverTheCap scrape) and
 * returns a normalized-name -> APY map for active QB contracts.
 *
 * This is the dataset documented in README.md as too stale to use as the
 * *primary* salary source (it missed most extensions signed after ~2022,
 * and has no rookie-contract data for 2023+ draft classes at all). It's
 * used here only as a free, no-API-key, best-effort PLACEHOLDER for QBs
 * we haven't been able to look up on Spotrac yet — never presented as a
 * confirmed real cap hit. Callers should flag anything sourced from this
 * as an estimate.
 */
async function fetchQbApyEstimates() {
  const res = await fetch(CONTRACTS_URL);
  if (!res.ok) throw new Error(`contracts fetch failed: ${res.status}`);
  const { gunzipSync } = await import("node:zlib");
  const buf = Buffer.from(await res.arrayBuffer());
  const text = gunzipSync(buf).toString("utf-8");

  const rows = parseCsv(text).filter((r) => r.position === "QB" && r.is_active === "TRUE");
  const map = new Map();
  for (const r of rows) {
    const apy = toNum(r.apy);
    if (apy > 0) map.set(normalizeName(r.player), apy);
  }
  return map;
}

module.exports = {
  fetchStarterQbStats,
  fetchQbApyEstimates,
  normalizeName,
  parseCsv,
  SEASON,
  MIN_GAMES,
  MIN_ATTEMPTS,
};
