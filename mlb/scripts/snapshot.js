#!/usr/bin/env node
/**
 * MLB standings snapshot — daily cron job (see ../../.github/workflows/mlb-snapshot.yml)
 *
 * Fetches current MLB standings (regular season + wild card) and writes a
 * JSON snapshot of every team's full standings record — the same fields
 * app.js's fetchAllStandings() pulls from the live API. The site uses this
 * two ways:
 *   - app.js diffs today's live magic numbers against today's morning
 *     snapshot (using just the wins/losses fields) to flag cells that
 *     dropped since the snapshot was taken.
 *   - the "By Date" tab rebuilds the full League/Division standings views
 *     exactly as they looked on a chosen date, using every stored field.
 *
 * The file is named by the US-Eastern "baseball day" (not UTC), since that's
 * the calendar MLB schedules games against, regardless of what UTC time this
 * cron happens to fire at.
 *
 * Usage: node snapshot.js [outDir]   (default outDir: ./out)
 */

const STANDINGS_BASE = "https://statsapi.mlb.com/api/v1/standings";

function easternDateString(d = new Date()) {
  // en-CA gives YYYY-MM-DD directly; timeZone pins it to the ET calendar day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

async function main() {
  const [divRes, wcRes] = await Promise.all([
    fetch(`${STANDINGS_BASE}?leagueId=103,104&standingsTypes=regularSeason`),
    fetch(`${STANDINGS_BASE}?leagueId=103,104&standingsTypes=wildCard`),
  ]);
  if (!divRes.ok || !wcRes.ok) {
    throw new Error(`standings request failed: ${divRes.status}/${wcRes.status}`);
  }
  const divJson = await divRes.json();
  const wcJson = await wcRes.json();

  // wildCardRank lookup by team id, same as app.js's fetchAllStandings.
  const wcByTeam = {};
  for (const rec of wcJson.records || []) {
    for (const tr of rec.teamRecords || []) {
      wcByTeam[tr.team.id] = tr;
    }
  }

  const teams = {};
  for (const rec of divJson.records || []) {
    const divisionId = rec.division ? rec.division.id : null;
    const leagueId = rec.league ? rec.league.id : null;
    for (const tr of rec.teamRecords || []) {
      const wc = wcByTeam[tr.team.id] || {};
      teams[tr.team.id] = {
        divisionId,
        leagueId,
        wins: tr.wins,
        losses: tr.losses,
        gamesPlayed: tr.gamesPlayed,
        winningPercentage: tr.winningPercentage,
        divisionGamesBack: tr.divisionGamesBack,
        leagueGamesBack: tr.leagueGamesBack,
        wildCardGamesBack: tr.wildCardGamesBack,
        divisionRank: tr.divisionRank,
        divisionLeader: !!tr.divisionLeader,
        divisionChamp: !!tr.divisionChamp,
        clinched: !!tr.clinched,
        eliminationNumber: tr.eliminationNumber,
        wildCardEliminationNumber: tr.wildCardEliminationNumber,
        wildCardRank: wc.wildCardRank,
      };
    }
  }

  const teamCount = Object.keys(teams).length;
  if (teamCount < 30) {
    // Sanity check — a partial/malformed response shouldn't get published,
    // since a bad snapshot would poison every date-diff and history view
    // that reads it.
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
