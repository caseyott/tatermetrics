#!/usr/bin/env node
/**
 * MLB standings snapshot — CLI entry point.
 *
 * Fetches current MLB standings and writes a JSON snapshot to disk (see
 * ./lib/standings.js for the actual fetch/shape logic, shared with the
 * Lambda handler in ./lambda/index.js).
 *
 * The daily run now happens via Lambda + EventBridge Scheduler (see
 * ../../terraform/modules/lambda_snapshot) — this CLI script is kept for
 * manual/local runs, backfills, and the workflow_dispatch-only
 * ../../.github/workflows/mlb-snapshot.yml.
 *
 * Usage: node snapshot.js [outDir]   (default outDir: ./out)
 */

const { fetchStandingsSnapshot } = require("./lib/standings");

async function main() {
  const { date, teamCount, snapshot } = await fetchStandingsSnapshot();

  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const outDir = process.argv[2] || "./out";
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${date}.json`);
  writeFileSync(outFile, JSON.stringify(snapshot));
  console.log(`Wrote ${outFile} (${teamCount} teams)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
