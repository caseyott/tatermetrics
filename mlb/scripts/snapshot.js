#!/usr/bin/env node
/**
 * MLB standings snapshot — daily cron job (see ../../.github/workflows/mlb-snapshot.yml)
 *
 * Fetches current MLB standings and writes a small JSON file recording each
 * team's wins/losses. app.js fetches yesterday's file the next day and
 * re-derives the magic number as of that date (magicNumber depends only on
 * wins/losses), diffing it against today's live number to flag cells that
 * dropped.
 *
 * The file is named by the US-Eastern "baseball day" (not UTC), since that's
 * the calendar MLB schedules games against, regardless of what UTC time this
 * cron happens to fire at.
 *
 * Usage: node snapshot.js [outDir]   (default outDir: ./out)
 */

const STANDINGS_URL =
  "https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&standingsTypes=regularSeason";

function easternDateString(d = new Date()) {
  // en-CA gives YYYY-MM-DD directly; timeZone pins it to the ET calendar day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

async function main() {
  const res = await fetch(STANDINGS_URL);
  if (!res.ok) {
    throw new Error(`standings request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();

  const teams = {};
  for (const rec of json.records || []) {
    for (const tr of rec.teamRecords || []) {
      teams[tr.team.id] = { wins: tr.wins, losses: tr.losses };
    }
  }

  const teamCount = Object.keys(teams).length;
  if (teamCount < 30) {
    // Sanity check — a partial/malformed response shouldn't get published,
    // since a bad snapshot would poison tomorrow's diff for every team.
    throw new Error(`expected 30 teams, got ${teamCount} — refusing to write snapshot`);
  }

  const date = easternDateString();
  const snapshot = { date, generatedAt: new Date().toISOString(), teams };

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
