/**
 * Spotrac salary lookup via the Parse.bot managed API
 * (https://parse.bot/marketplace/7994a459-31cd-4d12-a28b-5c053246f105/spotrac-com-api).
 *
 * This is the *real* per-season cap hit — not an APY proxy. The
 * nflverse/OverTheCap contracts dataset (see qbdata.js's older revision,
 * still used for total-value/guaranteed context) turned out to be badly
 * stale for extensions signed after ~2022 (e.g. it had Aaron Rodgers at his
 * old $50M/yr Jets APY instead of his real 2025 Steelers deal, and Jalen
 * Hurts/Lamar Jackson/Jordan Love still on rookie-scale numbers). Spotrac's
 * per-year cap hit table is current and also covers players still on
 * rookie deals that the OTC dataset hadn't picked up at all (Bo Nix, C.J.
 * Stroud, etc.) — see README.md.
 *
 * Requires PARSE_API_KEY (see nfl/.env, gitignored). Free tier is rate
 * limited to 5 req/min, so calls here are throttled and retried on 429.
 */

const SPOTRAC_BASE =
  "https://api.parse.bot/scraper/1063a484-f52f-4db5-a50f-b26705848e2f";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callEndpoint(endpoint, params, apiKey, { retries = 5 } = {}) {
  const url = new URL(`${SPOTRAC_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
    const dailyRemaining = res.headers.get("x-ratelimit-daily-remaining");
    const dailyReset = res.headers.get("x-ratelimit-daily-reset");
    if (res.status === 429) {
      if (dailyRemaining === "0") {
        const resetMins = dailyReset ? Math.ceil(Number(dailyReset) / 60) : null;
        throw new Error(
          `daily request quota exhausted${resetMins ? ` (resets in ~${resetMins} min)` : ""}`
        );
      }
      const wait = 12000 * (attempt + 1);
      console.warn(`  rate limited on ${endpoint}, waiting ${wait}ms...`);
      await sleep(wait);
      continue;
    }
    const json = await res.json();
    if (json.status === "success") return json.data;
    throw new Error(`${endpoint} failed: ${JSON.stringify(json)}`);
  }
  throw new Error(`${endpoint} failed after ${retries} retries (rate limited)`);
}

/** Finds the Spotrac QB player_id for a given display name, or null. */
async function findQbPlayerId(name, apiKey) {
  const data = await callEndpoint("search_players", { query: name }, apiKey);
  const results = data.results || [];
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();

  // Prefer an exact, QB-tagged match; fall back progressively since a few
  // search results come back with a blank `position` field even for real
  // QBs (seen for Sam Darnold, Jalen Hurts during testing).
  const exactQb = results.find((r) => r.position === "Quarterback" && r.name === name);
  if (exactQb) return exactQb.player_id;

  const looseQb = results.find(
    (r) => r.position === "Quarterback" && norm(r.name) === norm(name)
  );
  if (looseQb) return looseQb.player_id;

  const exactAnyPosition = results.find((r) => r.name === name);
  if (exactAnyPosition) return exactAnyPosition.player_id;

  const looseAnyPosition = results.find((r) => norm(r.name) === norm(name));
  return looseAnyPosition ? looseAnyPosition.player_id : null;
}

function parseDollar(s) {
  if (!s) return null;
  const n = Number(String(s).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parsePct(s) {
  if (!s) return null;
  const n = Number(String(s).replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pulls the cap-hit table out of a get_player_contract response and
 * extracts the given season's cap hit + cap % of league cap.
 *
 * Searches every table with a "Cap Hit" column for one that has a row for
 * `year` — not just the one tagged "(CURRENT)". That tag reflects the
 * player's *present* contract, which doesn't always cover a past season:
 * e.g. Aaron Rodgers' "(CURRENT)" table only spans 2026 (he's a free
 * agent), but a separate table covers his real, signed 2025 Steelers
 * deal. Tables are checked in order, so the current deal still wins when
 * more than one table happens to cover the requested year.
 *
 * Returns { capHit, capPct, underContract } — underContract is false when
 * that specific table's status segment says "Free Agent" for that year
 * (the number shown, if any, is leftover dead-cap bookkeeping, not real
 * pay).
 */
function extractCapHitForYear(contractData, year) {
  const tables = contractData.tables || [];
  const capTables = tables.filter((t) => t.headers.some((h) => /cap hit/i.test(h)));

  for (const capTable of capTables) {
    const capHitIdx = capTable.headers.findIndex((h) => /cap hit/i.test(h));
    const capPctIdx = capTable.headers.findIndex((h) => /cap %/i.test(h));
    const row = capTable.rows.find((r) => r[0] === String(year));
    if (!row) continue;

    const capHit = parseDollar(row[capHitIdx]);
    if (capHit === null) continue;

    const underContract = !/free agent/i.test(capTable.title);
    const capPct = capPctIdx >= 0 ? parsePct(row[capPctIdx]) : null;
    return { capHit, capPct, underContract };
  }
  return null;
}

/**
 * Fallback for when no Cap Hit table covers `year` — happens for veterans
 * who've since signed a newer deal (confirmed on Matthew Stafford's raw
 * data: his "(CURRENT)" cap-hit tables only cover his 2026 extension;
 * Spotrac doesn't appear to retain a Cap Hit breakdown for a superseded
 * contract). The player's "Earnings Per Year" table still has a plain
 * cash-paid figure per season, which is a reasonable stand-in: it's real
 * money that player was paid that year, just not the accounting cap-hit
 * number. Always flagged with isApprox so callers/UI can label it clearly
 * rather than presenting it as equivalent to a real cap hit.
 */
function extractCashForYear(contractData, year) {
  const tables = contractData.tables || [];
  const table = tables.find((t) => t.title === "Earnings Per Year");
  if (!table) return null;

  const cashIdx = table.headers.findIndex((h) => /cashtotal/i.test(h));
  if (cashIdx < 0) return null;
  const row = table.rows.find((r) => r[0] === String(year));
  if (!row) return null;

  const cash = parseDollar(row[cashIdx]);
  if (cash === null) return null;

  return { capHit: cash, capPct: null, underContract: true, isApprox: true };
}

/**
 * Looks up a QB's salary for `year`: real cap hit if a Cap Hit table
 * covers it, otherwise the "Earnings Per Year" cash-paid fallback (see
 * extractCashForYear), flagged with isApprox. Returns { found: false }
 * if the player isn't on Spotrac at all, or { found: true, capHit: null }
 * if found but neither source covers `year`.
 */
async function fetchQbCapHit(name, year, apiKey) {
  const playerId = await findQbPlayerId(name, apiKey);
  if (!playerId) return { found: false };
  const contractData = await callEndpoint(
    "get_player_contract",
    { player_id: playerId },
    apiKey
  );
  const capHit = extractCapHitForYear(contractData, year) || extractCashForYear(contractData, year);
  if (!capHit) return { found: true, playerId, capHit: null };
  return { found: true, playerId, ...capHit };
}

module.exports = { fetchQbCapHit, findQbPlayerId, extractCapHitForYear, extractCashForYear, sleep };
