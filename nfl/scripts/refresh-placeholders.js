#!/usr/bin/env node
/**
 * Rebuilds data/qb.json from progress.json's already-confirmed Spotrac
 * results, WITHOUT making any Spotrac API calls or touching PARSE_API_KEY
 * at all — fills in every QB who doesn't have a confirmed real cap hit
 * yet with a free, clearly-flagged placeholder (see lib/finalize.js), so
 * the site can show all 34 starter QBs' stats immediately even while
 * Spotrac quota/credits are unavailable.
 *
 * Once quota's back, run snapshot.js to replace placeholders with real
 * data — it reads the same progress.json and won't re-pay for QBs
 * already confirmed real.
 *
 * Usage: node refresh-placeholders.js [outFile]
 */

const { fetchStarterQbStats, fetchQbApyEstimates, SEASON, MIN_GAMES, MIN_ATTEMPTS } = require("./lib/qbdata");
const { buildFinalSnapshot } = require("./lib/finalize");

async function main() {
  const fs = await import("node:fs");
  const { join, dirname } = await import("node:path");

  const outFile = process.argv[2] || join(__dirname, "..", "data", "qb.json");
  const progressFile = join(dirname(outFile), "progress.json");

  let progress;
  if (fs.existsSync(progressFile)) {
    progress = JSON.parse(fs.readFileSync(progressFile, "utf-8"));
    console.log(
      `Loaded progress.json: ${progress.done.length}/${progress.starters.length} already looked up on Spotrac.`
    );
  } else {
    console.log("No progress.json found — fetching fresh stats (no prior Spotrac data at all).");
    const starters = await fetchStarterQbStats();
    progress = { starters, done: [] };
  }

  console.log("Fetching nflverse contracts APY estimates (free, no API key)...");
  const apyMap = await fetchQbApyEstimates();
  console.log(`${apyMap.size} active QB contracts found in nflverse data.`);

  const snapshot = buildFinalSnapshot(progress, apyMap, {
    statsSeason: SEASON,
    salaryYear: SEASON,
    minGames: MIN_GAMES,
    minAttempts: MIN_ATTEMPTS,
  });

  fs.mkdirSync(dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));

  const real = snapshot.qbs.filter((q) => !q.salary.isPlaceholder).length;
  const estimated = snapshot.qbs.filter((q) => q.salary.source === "nflverse_apy_estimate").length;
  const flat = snapshot.qbs.filter((q) => q.salary.source === "placeholder_flat").length;
  console.log(
    `\nWrote ${outFile}: ${snapshot.qbs.length} QBs total — ${real} real Spotrac salary, ${estimated} nflverse APY estimate, ${flat} flat placeholder.`
  );
  console.log(`${snapshot.salaryPending.length} still need a real Spotrac lookup: ${snapshot.salaryPending.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
