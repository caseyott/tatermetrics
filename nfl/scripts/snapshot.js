#!/usr/bin/env node
/**
 * NFL QB salary-vs-stats snapshot — CLI entry point.
 *
 * Fetches 2025 season stats (nflverse) for starter-level QBs, then looks
 * up each one's real 2025 cap hit on Spotrac (via the Parse.bot managed
 * API — see lib/spotrac.js) and writes a joined JSON snapshot to disk.
 * Stats and salary are mapped to the *same* season on purpose — what each
 * QB actually earned during the year those stats were produced.
 *
 * RESUMABLE: this is designed to be re-run many times. Progress is saved
 * to progress.json (next to the output file) after every single QB, so a
 * run that gets interrupted — or stops early on purpose because Spotrac's
 * daily request quota ran out (free tier: 100 req/day, ~2 req/QB) — picks
 * back up exactly where it left off on the next run instead of re-paying
 * for QBs already looked up. Delete progress.json to force a full re-run.
 *
 * Requires PARSE_API_KEY, read from nfl/.env (gitignored — never commit
 * it).
 *
 * Usage: node snapshot.js [outFile]   (default outFile: ../data/qb.json)
 */

const { fetchStarterQbStats, fetchQbApyEstimates, SEASON, MIN_GAMES, MIN_ATTEMPTS } = require("./lib/qbdata");
const { fetchQbCapHit, sleep } = require("./lib/spotrac");
const { buildFinalSnapshot } = require("./lib/finalize");

const SALARY_YEAR = SEASON; // same-year mapping: 2025 stats -> 2025 salary
const REQUEST_DELAY_MS = 5000;
const NEGATIVE_RETRY_DELAY_MS = 10000;
const MAX_NEGATIVE_RETRIES = 1;

// Sustained back-to-back automated calls have, in testing, produced
// "success" responses with wrong data for players who are unambiguously
// under contract (Dak Prescott, Lamar Jackson, Joe Burrow, etc. briefly
// came back "not under contract" / "not found" during a fast automated
// run, then resolved correctly seconds later on an isolated retry). So
// those two specific results aren't trusted on the first try — retried a
// couple of times with a longer pause before being accepted as real.
//
// A *third* negative outcome — capHit === null, meaning neither a Cap Hit
// table nor the "Earnings Per Year" cash fallback covers the requested
// year (see lib/spotrac.js) — is NOT retried. Verified directly against
// Matthew Stafford's raw Spotrac data: this happens because he signed a
// newer deal, and Spotrac genuinely doesn't retain a per-year breakdown
// for the superseded contract. Retrying a real, stable data gap just pays
// full price again for the same answer — this was most of what burned
// through the account's monthly credits, so it's now a one-shot lookup.
function isRetryableNegative(result) {
  return !result.found || (result.capHit && !result.capHit.underContract);
}

async function fetchQbCapHitVerified(name, year, apiKey) {
  let result = await fetchQbCapHit(name, year, apiKey);
  for (let attempt = 0; isRetryableNegative(result) && attempt < MAX_NEGATIVE_RETRIES; attempt++) {
    console.log(`  suspicious negative result for ${name}, re-verifying (attempt ${attempt + 1})...`);
    await sleep(NEGATIVE_RETRY_DELAY_MS);
    result = await fetchQbCapHit(name, year, apiKey);
  }
  return result;
}

function loadEnvFile(path) {
  try {
    const fs = require("node:fs");
    const text = fs.readFileSync(path, "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env file — fine if PARSE_API_KEY is already set in the environment
  }
}

async function main() {
  const fs = await import("node:fs");
  const { join, dirname } = await import("node:path");
  loadEnvFile(join(__dirname, "..", ".env"));

  const apiKey = process.env.PARSE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "PARSE_API_KEY not set. Add it to nfl/.env (gitignored) — see README.md."
    );
  }

  const outFile = process.argv[2] || join(__dirname, "..", "data", "qb.json");
  const progressFile = join(dirname(outFile), "progress.json");

  let progress;
  if (fs.existsSync(progressFile)) {
    progress = JSON.parse(fs.readFileSync(progressFile, "utf-8"));
    console.log(
      `Resuming: ${progress.done.length}/${progress.starters.length} already looked up.`
    );
  } else {
    console.log("Fetching 2025 season QB stats...");
    const starters = await fetchStarterQbStats();
    console.log(`${starters.length} starter QBs (8+ games, 224+ attempts).`);
    progress = { starters, done: [] };
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
  }

  const doneNames = new Set(progress.done.map((d) => d.name));
  const remaining = progress.starters.filter((s) => !doneNames.has(s.name));

  if (remaining.length === 0) {
    console.log("All QBs already looked up — finalizing.");
  }

  for (const [i, qb] of remaining.entries()) {
    console.log(`[${progress.done.length + 1}/${progress.starters.length}] ${qb.name} (${qb.team})...`);
    if (i > 0) await sleep(REQUEST_DELAY_MS);

    let result;
    try {
      result = await fetchQbCapHitVerified(qb.name, SALARY_YEAR, apiKey);
    } catch (err) {
      // Quota exhaustion (daily request cap, or monthly credits via a 402
      // "Usage limit exceeded") isn't a per-QB problem — stop the whole run
      // and leave every remaining QB as `pending` so the next run picks
      // them back up, instead of mis-recording them as excluded. Getting
      // this wrong once already meant Jacoby Brissett looked "excluded"
      // in progress.json when he'd simply never been looked up.
      if (/daily/i.test(err.message) || /429/.test(err.message) || /usage limit/i.test(err.message) || /402/.test(err.message)) {
        console.warn(`\nStopping: ${err.message}`);
        console.warn(
          `Progress saved (${progress.done.length}/${progress.starters.length}). Re-run this script later to continue.`
        );
        break;
      }
      console.warn(`  error: ${err.message} — marking excluded and continuing.`);
      progress.done.push({ name: qb.name, team: qb.team, stats: qb.stats, excludedReason: "spotrac_error" });
      fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
      continue;
    }

    let entry = { name: qb.name, team: qb.team, stats: qb.stats };
    if (!result.found) {
      entry.excludedReason = "not_found_on_spotrac";
    } else if (!result.capHit) {
      entry.excludedReason = "no_salary_data_for_year";
    } else if (!result.capHit.underContract) {
      entry.excludedReason = "not_under_contract_that_year";
    } else {
      entry.salary = {
        capHit: result.capHit.capHit,
        capPctOfLeagueCap: result.capHit.capPct,
        isApprox: !!result.capHit.isApprox,
      };
    }
    progress.done.push(entry);
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
  }

  // Finalize: always write a snapshot with all 34 starters present, using
  // a free nflverse-APY placeholder (see lib/finalize.js) for anyone still
  // missing a confirmed real Spotrac result, rather than dropping them.
  console.log("\nFetching nflverse contracts APY estimates for placeholder salaries (free)...");
  const apyMap = await fetchQbApyEstimates();

  const snapshot = buildFinalSnapshot(progress, apyMap, {
    statsSeason: SEASON,
    salaryYear: SALARY_YEAR,
    minGames: MIN_GAMES,
    minAttempts: MIN_ATTEMPTS,
  });

  fs.mkdirSync(dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));

  const real = snapshot.qbs.filter((q) => !q.salary.isPlaceholder).length;
  console.log(
    `\nWrote ${outFile}: ${snapshot.qbs.length} QBs total (${real} real Spotrac salary, ${snapshot.qbs.length - real} placeholder). ${snapshot.salaryPending.length} still need a real Spotrac lookup.`
  );
  if (snapshot.salaryPending.length === 0) {
    fs.unlinkSync(progressFile);
    console.log("All QBs resolved on Spotrac — removed progress.json.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
