/* MLB Magic Numbers — live standings + clinching grid
 * Data source: MLB Stats API (statsapi.mlb.com), no API key required.
 * Recreates the two playoffmagic.com/mlb views: League Standings and Division Standings.
 */

const STANDINGS_BASE = "https://statsapi.mlb.com/api/v1/standings";
const SEASON_TOTAL_GAMES = 162; // standard MLB season length used in the magic-number formula

const LEAGUES = [
  { id: 103, name: "American League", short: "AL" },
  { id: 104, name: "National League", short: "NL" },
];

// Static team metadata (id -> abbreviation/name) so we don't need an extra API round trip.
const TEAM_META = {
  108: { abbr: "LAA", name: "Los Angeles Angels" },
  109: { abbr: "AZ", name: "Arizona Diamondbacks" },
  110: { abbr: "BAL", name: "Baltimore Orioles" },
  111: { abbr: "BOS", name: "Boston Red Sox" },
  112: { abbr: "CHC", name: "Chicago Cubs" },
  113: { abbr: "CIN", name: "Cincinnati Reds" },
  114: { abbr: "CLE", name: "Cleveland Guardians" },
  115: { abbr: "COL", name: "Colorado Rockies" },
  116: { abbr: "DET", name: "Detroit Tigers" },
  117: { abbr: "HOU", name: "Houston Astros" },
  118: { abbr: "KC", name: "Kansas City Royals" },
  119: { abbr: "LAD", name: "Los Angeles Dodgers" },
  120: { abbr: "WSH", name: "Washington Nationals" },
  121: { abbr: "NYM", name: "New York Mets" },
  133: { abbr: "ATH", name: "Athletics" },
  134: { abbr: "PIT", name: "Pittsburgh Pirates" },
  135: { abbr: "SD", name: "San Diego Padres" },
  136: { abbr: "SEA", name: "Seattle Mariners" },
  137: { abbr: "SF", name: "San Francisco Giants" },
  138: { abbr: "STL", name: "St. Louis Cardinals" },
  139: { abbr: "TB", name: "Tampa Bay Rays" },
  140: { abbr: "TEX", name: "Texas Rangers" },
  141: { abbr: "TOR", name: "Toronto Blue Jays" },
  142: { abbr: "MIN", name: "Minnesota Twins" },
  143: { abbr: "PHI", name: "Philadelphia Phillies" },
  144: { abbr: "ATL", name: "Atlanta Braves" },
  145: { abbr: "CWS", name: "Chicago White Sox" },
  146: { abbr: "MIA", name: "Miami Marlins" },
  147: { abbr: "NYY", name: "New York Yankees" },
  158: { abbr: "MIL", name: "Milwaukee Brewers" },
};

// The standings API's division object only includes {id, link} — no name — so we
// map division id -> display name / geographic sort order ourselves.
const DIVISION_META = {
  201: { name: "American League East", sort: 0 },
  202: { name: "American League Central", sort: 1 },
  200: { name: "American League West", sort: 2 },
  204: { name: "National League East", sort: 0 },
  205: { name: "National League Central", sort: 1 },
  203: { name: "National League West", sort: 2 },
};


function numOrNull(v) {
  if (v === undefined || v === null || v === "-" || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function isEliminated(elimField) {
  if (elimField === undefined || elimField === null) return false;
  if (elimField === "E") return true;
  const n = numOrNull(elimField);
  return n !== null && n <= 0;
}

/** Fetch + merge regular season (division) standings and wild card standings for both leagues. */
async function fetchAllStandings() {
  const [divRes, wcRes] = await Promise.all([
    fetch(`${STANDINGS_BASE}?leagueId=103,104&standingsTypes=regularSeason`),
    fetch(`${STANDINGS_BASE}?leagueId=103,104&standingsTypes=wildCard`),
  ]);
  if (!divRes.ok || !wcRes.ok) {
    throw new Error("MLB Stats API request failed");
  }
  const divJson = await divRes.json();
  const wcJson = await wcRes.json();

  // wildCardRank / wildCardGamesBack lookup by team id
  const wcByTeam = {};
  let latestUpdate = null;
  wcJson.records.forEach((rec) => {
    (rec.teamRecords || []).forEach((tr) => {
      wcByTeam[tr.team.id] = tr;
    });
    if (rec.lastUpdated) latestUpdate = rec.lastUpdated;
  });

  const teams = [];
  divJson.records.forEach((rec) => {
    const divisionId = rec.division ? rec.division.id : null;
    const divMeta = DIVISION_META[divisionId] || { name: "Unknown Division", sort: 3 };
    const leagueId = rec.league ? rec.league.id : null;
    if (rec.lastUpdated) latestUpdate = rec.lastUpdated;
    (rec.teamRecords || []).forEach((tr) => {
      const meta = TEAM_META[tr.team.id] || { abbr: tr.team.name.slice(0, 3).toUpperCase(), name: tr.team.name };
      const wc = wcByTeam[tr.team.id] || {};
      const wins = tr.wins;
      const losses = tr.losses;
      const gamesPlayed = tr.gamesPlayed != null ? tr.gamesPlayed : wins + losses;
      teams.push({
        id: tr.team.id,
        abbr: meta.abbr,
        name: meta.name,
        divisionId,
        divisionName: divMeta.name,
        divisionSort: divMeta.sort,
        leagueId,
        wins,
        losses,
        gamesPlayed,
        gamesRemaining: Math.max(SEASON_TOTAL_GAMES - gamesPlayed, 0),
        winPct: gamesPlayed > 0 ? wins / gamesPlayed : 0,
        pctDisplay: tr.winningPercentage || (wins + losses > 0 ? (wins / (wins + losses)).toFixed(3).replace(/^0/, "") : ".000"),
        divisionGamesBack: tr.divisionGamesBack || "-",
        leagueGamesBack: tr.leagueGamesBack || "-",
        wildCardGamesBack: tr.wildCardGamesBack || "-",
        divisionRank: numOrNull(tr.divisionRank) || 99,
        divisionLeader: !!tr.divisionLeader,
        divisionChamp: !!tr.divisionChamp,
        clinched: !!tr.clinched,
        eliminationNumber: tr.eliminationNumber,
        wildCardEliminationNumber: tr.wildCardEliminationNumber,
        wildCardRank: numOrNull(wc.wildCardRank),
      });
    });
  });

  return { teams, lastUpdated: latestUpdate };
}

/** Magic number for `a` to eliminate `b` from finishing ahead of them: standard formula. */
function magicNumber(a, b) {
  return SEASON_TOTAL_GAMES + 1 - a.wins - b.losses;
}

function isAheadOf(a, b) {
  if (a.winPct !== b.winPct) return a.winPct > b.winPct;
  if (a.wins !== b.wins) return a.wins > b.wins;
  return a.losses < b.losses;
}

function statusClass(team) {
  if (team.divisionChamp) return "clinched-division";
  if (team.clinched) return "clinched-wildcard";
  const divElim = isEliminated(team.eliminationNumber);
  const wcElim = isEliminated(team.wildCardEliminationNumber) || (team.wildCardEliminationNumber === undefined && divElim);
  if (divElim && wcElim) return "eliminated";
  return "";
}

function statusTag(team) {
  const cls = statusClass(team);
  if (cls === "clinched-division") return '<span class="status-tag div">DIV</span>';
  if (cls === "clinched-wildcard") return '<span class="status-tag wc">WC</span>';
  if (cls === "eliminated") return '<span class="status-tag elim">E</span>';
  return "";
}

function gbDisplay(v) {
  if (v === "-" || v === null || v === undefined) return "&ndash;";
  return v;
}

/** Build the ordered row list for a league's League Standings page:
 *  1) the 3 division leaders (East, Central, West)
 *  2) the top 3 non-leaders by wild card rank
 *  3) everyone else by wild card rank
 */
function buildLeagueOrder(leagueTeams) {
  const leaders = leagueTeams
    .filter((t) => t.divisionLeader)
    .sort((a, b) => a.divisionSort - b.divisionSort);
  const rest = leagueTeams
    .filter((t) => !t.divisionLeader)
    .sort((a, b) => (a.wildCardRank || 99) - (b.wildCardRank || 99));
  return [...leaders, ...rest];
}

function buildDivisionOrder(divisionTeams) {
  return [...divisionTeams].sort((a, b) => a.divisionRank - b.divisionRank);
}

function renderMatrixCell(rowTeam, colTeam) {
  if (rowTeam.id === colTeam.id) return '<td class="diag"></td>';
  if (isAheadOf(rowTeam, colTeam)) {
    const mn = magicNumber(rowTeam, colTeam);
    if (mn <= 0) return '<td class="magic-num">&ndash;</td>';
    return `<td class="magic-num">${mn}</td>`;
  }
  return '<td class="nc">NC</td>';
}

function teamCell(team) {
  return `<td class="team-cell">${team.abbr}${statusTag(team)}<span class="team-name">${team.name}</span></td>`;
}

function renderTable(rows, columns, opts) {
  const showWcGb = !!opts.showWcGb;
  let head = '<tr><th class="team-cell">Team</th><th>GP/R</th><th>W</th><th>L</th><th>PCT</th><th>GB</th>';
  if (showWcGb) head += "<th>WCGB</th>";
  columns.forEach((c) => {
    head += `<th>${c.abbr}</th>`;
  });
  head += "</tr>";

  let body = "";
  rows.forEach((team) => {
    const cls = statusClass(team);
    body += `<tr class="${cls}">`;
    body += teamCell(team);
    body += `<td class="record-cell">${team.gamesPlayed}/${team.gamesRemaining}</td>`;
    body += `<td class="record-cell">${team.wins}</td>`;
    body += `<td class="record-cell">${team.losses}</td>`;
    body += `<td class="record-cell">${team.pctDisplay}</td>`;
    body += `<td class="record-cell">${gbDisplay(opts.gbField === "league" ? team.leagueGamesBack : team.divisionGamesBack)}</td>`;
    if (showWcGb) body += `<td class="record-cell">${gbDisplay(team.wildCardGamesBack)}</td>`;
    columns.forEach((col) => {
      body += renderMatrixCell(team, col);
    });
    body += "</tr>";
  });

  return `<div class="table-scroll"><table class="standings"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderLeagueView(teams) {
  let html = "";
  LEAGUES.forEach((lg) => {
    const leagueTeams = teams.filter((t) => t.leagueId === lg.id);
    const ordered = buildLeagueOrder(leagueTeams);
    html += `<div class="division-block"><h3>${lg.name}</h3>`;
    html += renderTable(ordered, ordered, { showWcGb: true, gbField: "league" });
    html += "</div>";
  });
  return html;
}

function renderDivisionView(teams) {
  const divisions = {};
  teams.forEach((t) => {
    if (!divisions[t.divisionName]) divisions[t.divisionName] = [];
    divisions[t.divisionName].push(t);
  });
  const orderedDivNames = Object.keys(divisions).sort((a, b) => {
    const ta = divisions[a][0];
    const tb = divisions[b][0];
    if (ta.leagueId !== tb.leagueId) return ta.leagueId - tb.leagueId;
    return ta.divisionSort - tb.divisionSort;
  });

  let html = "";
  orderedDivNames.forEach((divName) => {
    const ordered = buildDivisionOrder(divisions[divName]);
    html += `<div class="division-block"><h3>${divName}</h3>`;
    html += renderTable(ordered, ordered, { showWcGb: false, gbField: "division" });
    html += "</div>";
  });
  return html;
}

function setStatus(msg, isError) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status" + (isError ? " error" : "");
  el.style.display = msg ? "block" : "none";
}

async function loadAndRender() {
  setStatus("Loading live standings…", false);
  try {
    const { teams, lastUpdated } = await fetchAllStandings();
    document.getElementById("league-view").innerHTML = renderLeagueView(teams);
    document.getElementById("division-view").innerHTML = renderDivisionView(teams);
    setStatus("", false);
    const stamp = lastUpdated ? new Date(lastUpdated) : new Date();
    document.getElementById("last-updated").textContent = `Data last updated: ${stamp.toLocaleString()} (page loaded ${new Date().toLocaleString()})`;
  } catch (err) {
    console.error(err);
    setStatus("Couldn't load live standings from the MLB Stats API. Please try refreshing in a moment.", true);
  }
}

function initTabs() {
  const buttons = document.querySelectorAll(".tabPill");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.getElementById("league-view").hidden = view !== "league";
      document.getElementById("division-view").hidden = view !== "division";
    });
  });
  document.getElementById("refresh-btn").addEventListener("click", loadAndRender);
}

initTabs();
loadAndRender();
