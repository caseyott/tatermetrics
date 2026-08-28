/**
 * Shared MLB standings fetch + shape logic.
 *
 * Pulled out of snapshot.js so the CLI script (run manually or via the
 * mlb-snapshot GitHub Actions workflow) and the Lambda handler
 * (scripts/lambda/index.js, run daily by EventBridge Scheduler) can't drift
 * out of sync with each other or with app.js's fetchAllStandings().
 */

const STANDINGS_BASE = "https://statsapi.mlb.com/api/v1/standings";

function easternDateString(d = new Date()) {
  // en-CA gives YYYY-MM-DD directly; timeZone pins it to the ET calendar day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

/**
 * Fetches current MLB standings (regular season + wild card) and returns a
 * snapshot of every team's full standings record, dated by the US-Eastern
 * "baseball day" (not UTC/whatever timezone this happens to run in).
 *
 * Throws if the response looks partial/malformed (fewer than 30 teams) —
 * callers should let that error abort the run rather than writing/uploading
 * a bad snapshot, since it would poison every date-diff and history view
 * that reads it.
 */
async function fetchStandingsSnapshot() {
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
    throw new Error(`expected 30 teams, got ${teamCount} — refusing to write snapshot`);
  }

  const date = easternDateString();
  const snapshot = { date, generatedAt: new Date().toISOString(), teams };

  return { date, teamCount, snapshot };
}

module.exports = { fetchStandingsSnapshot };
