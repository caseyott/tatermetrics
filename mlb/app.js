/* MLB Magic Numbers — live standings + clinching grid
 * Data source: MLB Stats API (statsapi.mlb.com), no API key required.
 * Recreates the two playoffmagic.com/mlb views: League Standings and Division Standings.
 */

const STANDINGS_BASE = "https://statsapi.mlb.com/api/v1/standings";
const SCHEDULE_BASE = "https://statsapi.mlb.com/api/v1/schedule";
const SEASON_TOTAL_GAMES = 162; // standard MLB season length used in the magic-number formula
const SCOREBOARD_REFRESH_MS = 10 * 60 * 1000; // 10 minutes

const LEAGUES = [
  { id: 103, name: "American League", short: "AL" },
  { id: 104, name: "National League", short: "NL" },
];

// Static team metadata (id -> abbreviation/name) so we don't need an extra API round trip.
const TEAM_META = {
  108: { abbr: "LAA", name: "Los Angeles Angels", short: "Angels" },
  109: { abbr: "AZ", name: "Arizona Diamondbacks", short: "Diamondbacks" },
  110: { abbr: "BAL", name: "Baltimore Orioles", short: "Orioles" },
  111: { abbr: "BOS", name: "Boston Red Sox", short: "Red Sox" },
  112: { abbr: "CHC", name: "Chicago Cubs", short: "Cubs" },
  113: { abbr: "CIN", name: "Cincinnati Reds", short: "Reds" },
  114: { abbr: "CLE", name: "Cleveland Guardians", short: "Guardians" },
  115: { abbr: "COL", name: "Colorado Rockies", short: "Rockies" },
  116: { abbr: "DET", name: "Detroit Tigers", short: "Tigers" },
  117: { abbr: "HOU", name: "Houston Astros", short: "Astros" },
  118: { abbr: "KC", name: "Kansas City Royals", short: "Royals" },
  119: { abbr: "LAD", name: "Los Angeles Dodgers", short: "Dodgers" },
  120: { abbr: "WSH", name: "Washington Nationals", short: "Nationals" },
  121: { abbr: "NYM", name: "New York Mets", short: "Mets" },
  133: { abbr: "ATH", name: "Athletics", short: "Athletics" },
  134: { abbr: "PIT", name: "Pittsburgh Pirates", short: "Pirates" },
  135: { abbr: "SD", name: "San Diego Padres", short: "Padres" },
  136: { abbr: "SEA", name: "Seattle Mariners", short: "Mariners" },
  137: { abbr: "SF", name: "San Francisco Giants", short: "Giants" },
  138: { abbr: "STL", name: "St. Louis Cardinals", short: "Cardinals" },
  139: { abbr: "TB", name: "Tampa Bay Rays", short: "Rays" },
  140: { abbr: "TEX", name: "Texas Rangers", short: "Rangers" },
  141: { abbr: "TOR", name: "Toronto Blue Jays", short: "Blue Jays" },
  142: { abbr: "MIN", name: "Minnesota Twins", short: "Twins" },
  143: { abbr: "PHI", name: "Philadelphia Phillies", short: "Phillies" },
  144: { abbr: "ATL", name: "Atlanta Braves", short: "Braves" },
  145: { abbr: "CWS", name: "Chicago White Sox", short: "White Sox" },
  146: { abbr: "MIA", name: "Miami Marlins", short: "Marlins" },
  147: { abbr: "NYY", name: "New York Yankees", short: "Yankees" },
  158: { abbr: "MIL", name: "Milwaukee Brewers", short: "Brewers" },
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

/** Turn one team's raw standings fields (from the live API, or from a stored
 *  snapshot — same field names either way) into the display-ready shape
 *  every render function expects. Shared by the live fetch below and by the
 *  "By Date" historical view, which rebuilds this from a data/*.json file. */
function buildTeamRecord(id, raw) {
  const meta = TEAM_META[id] || { abbr: String(id).slice(0, 3).toUpperCase(), name: `Team ${id}`, short: `Team ${id}` };
  const divMeta = DIVISION_META[raw.divisionId] || { name: "Unknown Division", sort: 3 };
  const wins = raw.wins;
  const losses = raw.losses;
  const gamesPlayed = raw.gamesPlayed != null ? raw.gamesPlayed : wins + losses;
  return {
    id,
    abbr: meta.abbr,
    name: meta.name,
    shortName: meta.short || meta.name,
    divisionId: raw.divisionId,
    divisionName: divMeta.name,
    divisionSort: divMeta.sort,
    leagueId: raw.leagueId,
    wins,
    losses,
    gamesPlayed,
    gamesRemaining: Math.max(SEASON_TOTAL_GAMES - gamesPlayed, 0),
    winPct: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    pctDisplay: raw.winningPercentage || (wins + losses > 0 ? (wins / (wins + losses)).toFixed(3).replace(/^0/, "") : ".000"),
    divisionGamesBack: raw.divisionGamesBack || "-",
    leagueGamesBack: raw.leagueGamesBack || "-",
    wildCardGamesBack: raw.wildCardGamesBack || "-",
    divisionRank: numOrNull(raw.divisionRank) || 99,
    divisionLeader: !!raw.divisionLeader,
    divisionChamp: !!raw.divisionChamp,
    clinched: !!raw.clinched,
    eliminationNumber: raw.eliminationNumber,
    wildCardEliminationNumber: raw.wildCardEliminationNumber,
    wildCardRank: numOrNull(raw.wildCardRank),
  };
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
    const leagueId = rec.league ? rec.league.id : null;
    if (rec.lastUpdated) latestUpdate = rec.lastUpdated;
    (rec.teamRecords || []).forEach((tr) => {
      const wc = wcByTeam[tr.team.id] || {};
      teams.push(
        buildTeamRecord(tr.team.id, {
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
          divisionLeader: tr.divisionLeader,
          divisionChamp: tr.divisionChamp,
          clinched: tr.clinched,
          eliminationNumber: tr.eliminationNumber,
          wildCardEliminationNumber: tr.wildCardEliminationNumber,
          wildCardRank: wc.wildCardRank,
        })
      );
    });
  });

  return { teams, lastUpdated: latestUpdate };
}

/** Magic number for `a` to eliminate `b` from finishing ahead of them: standard formula. */
function magicNumber(a, b) {
  return SEASON_TOTAL_GAMES + 1 - a.wins - b.losses;
}

/* =========================================================
   Since-last-snapshot magic number tracking
   ========================================================= */

const SNAPSHOT_LOOKBACK_DAYS = 4; // extra days to try if a cron run got missed

function easternDateString(d = new Date()) {
  // MLB schedules by the Eastern calendar day, regardless of the viewer's
  // own time zone or when the daily snapshot cron happens to fire in UTC.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

function addDays(dateStr, delta) {
  // Shift at UTC noon so the +/- day math never gets tripped up by DST.
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return easternDateString(d);
}

/** Find the most recent snapshot available: today's file (written by the
 *  ~5am ET cron, before today's games) if it's up yet, otherwise walk
 *  backwards a few days in case a cron run got missed. Comparing live
 *  standings against *today's* file is what lets a cell change mid-day as
 *  today's games finish, rather than waiting until tomorrow to show. */
async function fetchLatestSnapshot() {
  const todayET = easternDateString();
  for (let back = 0; back <= SNAPSHOT_LOOKBACK_DAYS; back++) {
    const dateStr = addDays(todayET, -back);
    try {
      const res = await fetch(`data/${dateStr}.json`, { cache: "no-store" });
      if (!res.ok) continue;
      const json = await res.json();
      if (json && json.teams) return json;
    } catch (err) {
      // this date's file is missing or unreadable — fall back further
    }
  }
  return null;
}

/** How much rowTeam's magic number against colTeam has dropped since the last
 *  snapshot (positive = closer to clinching). Null if we have no prior data
 *  for either team. Also reused by "By Date" comparison mode below, where
 *  `otherTeams` is whichever date/live standings the user picked to compare
 *  against rather than strictly "the previous snapshot". */
function magicNumberDelta(rowTeam, colTeam, otherTeams) {
  if (!otherTeams) return null;
  const otherRow = otherTeams[rowTeam.id];
  const otherCol = otherTeams[colTeam.id];
  if (!otherRow || !otherCol) return null;
  const otherMn = SEASON_TOTAL_GAMES + 1 - otherRow.wins - otherCol.losses;
  return otherMn - magicNumber(rowTeam, colTeam);
}

/* =========================================================
   "By Date" comparison mode — graduated diff shading
   A historical date can be compared to today (live) or another available
   date. Unlike the "since this morning" arrows above (which only ever see
   a gap of 1 or 2 games), an arbitrary date-to-date gap can be any size N,
   so differences are shown as a 4-step shading scale instead: darker means
   a bigger change. "Better" (green) always means the currently-displayed
   date's number is more favorable than the comparison point's — more wins,
   fewer losses, or a smaller magic number — regardless of whether that
   comparison point is chronologically before or after it.
   ========================================================= */

/** Build {cls, title} for a diff cell, or {cls:"", title:""} when there's
 *  nothing to highlight. `delta` should already be signed so that positive
 *  = better (displayed value) than the comparison, negative = worse. */
function diffShade(delta, label, statName) {
  if (!delta) return { cls: "", title: "" };
  const better = delta > 0;
  const bucket = Math.min(Math.abs(delta), 4);
  const cls = `diff-${better ? "better" : "worse"}-${bucket}`;
  const title = `${statName}: ${better ? "better" : "worse"} by ${Math.abs(delta)} vs ${label}`;
  return { cls, title };
}

/** Render a stat <td>, shaded/titled when `delta` is non-zero. */
function diffTd(baseClass, value, delta, label, statName) {
  const { cls, title } = diffShade(delta, label, statName);
  if (!cls) return `<td class="${baseClass}">${value}</td>`;
  return `<td class="${baseClass} ${cls}" title="${title}">${value}</td>`;
}

/* =========================================================
   "By Date" tab — full League + Division views as of a chosen
   past snapshot, read straight from data/<date>.json in S3.
   ========================================================= */

const SNAPSHOT_START_DATE = "2026-08-27"; // first date a snapshot exists

/** Every date from SNAPSHOT_START_DATE through today (ET), ascending. */
function historyDateOptions() {
  const dates = [];
  const todayET = easternDateString();
  let d = SNAPSHOT_START_DATE;
  while (d <= todayET) {
    dates.push(d);
    d = addDays(d, 1);
  }
  return dates;
}

async function fetchSnapshotForDate(dateStr) {
  const res = await fetch(`data/${dateStr}.json`);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json || !json.teams) return null;
  return json;
}

/** Rebuild the full display-ready teams array from a stored snapshot. */
function teamsFromSnapshot(snapshot) {
  return Object.entries(snapshot.teams).map(([id, raw]) => buildTeamRecord(Number(id), raw));
}

function setHistoryStatus(msg, isError) {
  const el = document.getElementById("history-status");
  el.textContent = msg;
  el.className = "status" + (isError ? " error" : "");
  el.style.display = msg ? "block" : "none";
}

/** Raw {id: {wins, losses}} map for today's live standings, in the same
 *  shape as a stored snapshot's `teams` field, so it can be diffed the
 *  same way as any other date. */
async function fetchTodayRaw() {
  const { teams } = await fetchAllStandings();
  const map = {};
  teams.forEach((t) => {
    map[t.id] = { wins: t.wins, losses: t.losses };
  });
  return map;
}

/** Load whichever comparison point the user picked: "today" (live) or
 *  another snapshot date. Returns the raw {id: {wins, losses}} map, or
 *  null if it couldn't be loaded. */
async function loadCompareTeams(target) {
  if (target === "today") return fetchTodayRaw();
  const snapshot = await fetchSnapshotForDate(target);
  return snapshot ? snapshot.teams : null;
}

/** Whichever comparison target is currently selected, or null if compare
 *  mode is off. */
function getCompareTarget() {
  const toggle = document.getElementById("history-compare-toggle");
  const targetSel = document.getElementById("history-compare-target");
  if (!toggle || !targetSel || !toggle.checked) return null;
  return targetSel.value;
}

/** Refill the "Compare to" dropdown with every available date except the
 *  one currently shown in "Standings as of" (comparing a date to itself is
 *  meaningless), keeping the previous selection if it's still valid. */
function populateCompareOptions(excludeDate) {
  const targetSel = document.getElementById("history-compare-target");
  if (!targetSel) return;
  const prevValue = targetSel.value;
  const dateOptions = historyDateOptions()
    .filter((d) => d !== excludeDate)
    .map((d) => `<option value="${d}">${d}</option>`)
    .join("");
  targetSel.innerHTML = `<option value="today">Today (live)</option>${dateOptions}`;
  const stillValid = Array.from(targetSel.options).some((o) => o.value === prevValue);
  targetSel.value = stillValid ? prevValue : "today";
}

async function loadHistoryView(dateStr) {
  populateCompareOptions(dateStr);
  setHistoryStatus(`Loading standings for ${dateStr}…`, false);
  document.getElementById("history-league").innerHTML = "";
  document.getElementById("history-division").innerHTML = "";
  try {
    const [snapshot, resultsMap] = await Promise.all([fetchSnapshotForDate(dateStr), fetchResultsMap(dateStr)]);
    if (!snapshot) {
      setHistoryStatus(`No snapshot found for ${dateStr} yet.`, true);
      return;
    }
    const teams = teamsFromSnapshot(snapshot);

    const target = getCompareTarget();
    let compare = null;
    let compareError = "";
    if (target) {
      const compareTeamsRaw = await loadCompareTeams(target);
      if (compareTeamsRaw) {
        compare = { teams: compareTeamsRaw, label: target === "today" ? "today" : target };
      } else {
        compareError = `Couldn't load comparison data for ${target === "today" ? "today" : target} — showing ${dateStr} without highlighting.`;
      }
    }

    document.getElementById("history-league").innerHTML =
      '<h2 class="historySectionTitle">League Standings</h2>' + renderLeagueView(teams, null, compare, resultsMap);
    document.getElementById("history-division").innerHTML =
      '<h2 class="historySectionTitle">Division Standings</h2>' + renderDivisionView(teams, null, compare, resultsMap);
    setHistoryStatus(compareError, !!compareError);
  } catch (err) {
    console.error(err);
    setHistoryStatus(`Couldn't load the snapshot for ${dateStr}.`, true);
  }
}

function initHistoryView() {
  const select = document.getElementById("history-date");
  if (!select) return;
  select.innerHTML = historyDateOptions()
    .map((d) => `<option value="${d}">${d}</option>`)
    .join("");
  select.value = SNAPSHOT_START_DATE;
  select.addEventListener("change", () => loadHistoryView(select.value));

  const toggle = document.getElementById("history-compare-toggle");
  const targetSel = document.getElementById("history-compare-target");
  const legend = document.getElementById("history-compare-legend");
  if (!toggle || !targetSel) return;
  populateCompareOptions(select.value);
  toggle.addEventListener("change", () => {
    targetSel.disabled = !toggle.checked;
    if (legend) legend.hidden = !toggle.checked;
    loadHistoryView(select.value);
  });
  targetSel.addEventListener("change", () => loadHistoryView(select.value));
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

function logoUrl(team) {
  return `https://www.mlbstatic.com/team-logos/${team.id}.svg`;
}

/** Build the ordered row list for a league's League Standings page:
 *  1) the 3 division leaders, by winning % descending
 *  2) the top 3 wild-card teams, by winning % descending
 *  3) everyone else, by winning % descending
 */
function buildLeagueOrder(leagueTeams) {
  const byRecord = (a, b) => b.winPct - a.winPct || b.wins - a.wins || a.losses - b.losses;
  const leaders = leagueTeams.filter((t) => t.divisionLeader).sort(byRecord);
  const rest = leagueTeams.filter((t) => !t.divisionLeader).sort(byRecord);
  return [...leaders, ...rest];
}

function buildDivisionOrder(divisionTeams) {
  return [...divisionTeams].sort((a, b) => a.divisionRank - b.divisionRank);
}

function renderMatrixCell(rowTeam, colTeam, prevTeams, compare) {
  if (rowTeam.id === colTeam.id) {
    return `<td class="diag"><img class="team-logo-diag" src="${logoUrl(rowTeam)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>`;
  }
  if (isAheadOf(rowTeam, colTeam)) {
    const mn = magicNumber(rowTeam, colTeam);
    if (mn <= 0) return '<td class="magic-num">&ndash;</td>';
    if (compare) {
      const delta = magicNumberDelta(rowTeam, colTeam, compare.teams);
      return diffTd("magic-num", mn, delta, compare.label, "Magic number");
    }
    const delta = magicNumberDelta(rowTeam, colTeam, prevTeams);
    let cls = "magic-num";
    let badge = "";
    if (delta === 1) {
      cls += " mn-down1";
      badge = '<span class="mn-arrow" title="down 1 since this morning\'s snapshot">&#9660;</span>';
    } else if (delta !== null && delta >= 2) {
      cls += " mn-down2";
      badge = `<span class="mn-arrow mn-arrow-double" title="down ${delta} since this morning's snapshot (doubleheader?)"><i class="ti ti-chevron-down" aria-hidden="true"></i><i class="ti ti-chevron-down" aria-hidden="true"></i></span>`;
    }
    return `<td class="${cls}">${mn}${badge}</td>`;
  }
  return '<td class="nc">NC</td>';
}

function resultBadge(team, resultsMap) {
  const result = resultsMap && resultsMap[team.id];
  if (!result) return "";
  const cls = result === "W" ? "win" : "loss";
  const title = result === "W" ? "Won that day's game" : "Lost that day's game";
  return `<span class="result-badge ${cls}" title="${title}">${result}</span>`;
}

function teamCell(team, showFullName, resultsMap) {
  const nameSpan = showFullName ? `<span class="team-name">${team.shortName}</span>` : "";
  // The result badge sits outside .team-cell-main so it pins to the right
  // edge of the column (via flex space-between) instead of drifting based
  // on how long the name to its left happens to be.
  return `<td class="team-cell" title="${team.name}"><span class="team-cell-main"><img class="team-logo" src="${logoUrl(team)}" alt="" loading="lazy" onerror="this.style.display='none'">${team.abbr}${statusTag(team)}${nameSpan}</span>${resultBadge(team, resultsMap)}</td>`;
}

/** Build a <colgroup> so the table is forced to fit the container width (no horizontal
 *  scrolling): the team column and each stat column get a fixed share, and whatever's
 *  left is split evenly across the per-opponent logo columns. */
function buildColgroup(numLogoCols, numStatCols) {
  const teamPct = 13;
  const statPct = 5;
  const statsTotal = statPct * numStatCols;
  const logoPct = (100 - teamPct - statsTotal) / numLogoCols;
  let cols = `<col style="width:${teamPct}%">`;
  for (let i = 0; i < numStatCols; i++) cols += `<col style="width:${statPct}%">`;
  for (let i = 0; i < numLogoCols; i++) cols += `<col style="width:${logoPct}%">`;
  return `<colgroup>${cols}</colgroup>`;
}

function renderTable(rows, columns, opts) {
  const showWcGb = !!opts.showWcGb;
  const showFullName = opts.showFullName !== false;
  const numStatCols = showWcGb ? 6 : 5;

  let head = '<tr><th class="team-cell">Team</th><th>GP/R</th><th>W</th><th>L</th><th>PCT</th><th>GB</th>';
  if (showWcGb) head += "<th>WCGB</th>";
  columns.forEach((c) => {
    head += `<th class="logo-head"><img class="team-logo-header" src="${logoUrl(c)}" alt="${c.abbr}" title="${c.name}" loading="lazy" onerror="this.replaceWith(document.createTextNode('${c.abbr}'))"></th>`;
  });
  head += "</tr>";

  const dividerAfter = opts.dividerAfter || {};
  const compare = opts.compare;
  let body = "";
  rows.forEach((team, i) => {
    const cls = statusClass(team);
    const divider = dividerAfter[i + 1] || "";
    body += `<tr class="${[cls, divider].filter(Boolean).join(" ")}">`;
    body += teamCell(team, showFullName, opts.resultsMap);
    body += `<td class="record-cell">${team.gamesPlayed}/${team.gamesRemaining}</td>`;

    // Bigger is better for wins, smaller is better for losses — sign the
    // deltas accordingly so diffShade's "positive = better" rule holds.
    const otherRaw = compare && compare.teams[team.id];
    const winsDelta = otherRaw && otherRaw.wins != null ? team.wins - otherRaw.wins : null;
    const lossesDelta = otherRaw && otherRaw.losses != null ? otherRaw.losses - team.losses : null;
    body += compare
      ? diffTd("record-cell", team.wins, winsDelta, compare.label, "Wins")
      : `<td class="record-cell">${team.wins}</td>`;
    body += compare
      ? diffTd("record-cell", team.losses, lossesDelta, compare.label, "Losses")
      : `<td class="record-cell">${team.losses}</td>`;

    body += `<td class="record-cell">${team.pctDisplay}</td>`;
    body += `<td class="record-cell">${gbDisplay(opts.gbField === "league" ? team.leagueGamesBack : team.divisionGamesBack)}</td>`;
    if (showWcGb) body += `<td class="record-cell">${gbDisplay(team.wildCardGamesBack)}</td>`;
    columns.forEach((col) => {
      body += renderMatrixCell(team, col, opts.prevTeams, compare);
    });
    body += "</tr>";
  });

  const colgroup = buildColgroup(columns.length, numStatCols);
  return `<div class="table-scroll"><table class="standings">${colgroup}<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderLeagueView(teams, prevTeams, compare, resultsMap) {
  let html = "";
  LEAGUES.forEach((lg) => {
    const leagueTeams = teams.filter((t) => t.leagueId === lg.id);
    const ordered = buildLeagueOrder(leagueTeams);
    const headerCls = lg.id === 103 ? " leagueBannerAL" : "";
    html += `<div class="division-block"><h3 class="${headerCls}">${lg.name}</h3>`;
    // Row 3 = the last of the 3 division leaders; row 6 = the last of the 3 wild-card
    // spots (6 total current playoff teams). Bold dividers mark the current cutoffs.
    html += renderTable(ordered, ordered, {
      showWcGb: true,
      gbField: "league",
      dividerAfter: { 3: "lineTop3", 6: "lineTop6" },
      prevTeams,
      compare,
      resultsMap,
    });
    html += "</div>";
  });
  return html;
}

function renderDivisionView(teams, prevTeams, compare, resultsMap) {
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
    const headerCls = divisions[divName][0].leagueId === 103 ? " leagueBannerAL" : "";
    html += `<div class="division-block"><h3 class="${headerCls}">${divName}</h3>`;
    html += renderTable(ordered, ordered, { showWcGb: false, gbField: "division", prevTeams, compare, resultsMap });
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
    const [{ teams, lastUpdated }, latestSnapshot, resultsMap] = await Promise.all([
      fetchAllStandings(),
      fetchLatestSnapshot(),
      fetchResultsMap(todayISODate()),
    ]);
    const prevTeams = latestSnapshot ? latestSnapshot.teams : null;
    document.getElementById("league-view").innerHTML = renderLeagueView(teams, prevTeams, null, resultsMap);
    document.getElementById("division-view").innerHTML = renderDivisionView(teams, prevTeams, null, resultsMap);
    setStatus("", false);
    const stamp = lastUpdated ? new Date(lastUpdated) : new Date();
    document.getElementById("last-updated").textContent = `Data last updated: ${stamp.toLocaleString()} (page loaded ${new Date().toLocaleString()})`;
  } catch (err) {
    console.error(err);
    setStatus("Couldn't load live standings from the MLB Stats API. Please try refreshing in a moment.", true);
  }
}

/* =========================================================
   Live scoreboard bar (today's games, refreshes every 10 min)
   ========================================================= */

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatGameTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/** {teamId: "W"|"L"} for every *finished* game on `dateStr`, so the team
 *  column can show a same-day result badge. Used both for today (live
 *  views) and for whichever date is selected in "By Date" — since a
 *  history snapshot is taken before that day's games, the badge shows what
 *  happened afterward. A doubleheader's second game simply overwrites the
 *  first, since the schedule API returns games in start-time order. */
async function fetchResultsMap(dateStr) {
  try {
    const res = await fetch(`${SCHEDULE_BASE}?sportId=1&date=${dateStr}&hydrate=linescore,team`);
    if (!res.ok) return {};
    const json = await res.json();
    const games = (json.dates && json.dates[0] && json.dates[0].games) || [];
    const map = {};
    games.forEach((game) => {
      if ((game.status || {}).abstractGameState !== "Final") return;
      const away = game.teams.away;
      const home = game.teams.home;
      if (away && away.team) map[away.team.id] = away.isWinner ? "W" : "L";
      if (home && home.team) map[home.team.id] = home.isWinner ? "W" : "L";
    });
    return map;
  } catch (err) {
    console.error(err);
    return {};
  }
}

function gameStatusLabel(game) {
  const status = game.status || {};
  const detailed = status.detailedState || "";
  if (status.abstractGameState === "Live") {
    const ls = game.linescore || {};
    if (ls.inningState && ls.currentInningOrdinal) {
      return `${ls.inningState} ${ls.currentInningOrdinal}`;
    }
    return detailed || "Live";
  }
  if (status.abstractGameState === "Final") {
    const ls = game.linescore || {};
    if (ls.currentInning && ls.currentInning !== 9) return `Final/${ls.currentInning}`;
    return "Final";
  }
  if (detailed === "Postponed" || detailed === "Cancelled" || detailed === "Suspended") return detailed;
  if (detailed === "Warmup") return "Warmup";
  return formatGameTime(game.gameDate);
}

function renderGameCard(game) {
  const away = game.teams.away;
  const home = game.teams.home;
  const awayMeta = TEAM_META[away.team.id] || { abbr: away.team.name.slice(0, 3).toUpperCase(), name: away.team.name };
  const homeMeta = TEAM_META[home.team.id] || { abbr: home.team.name.slice(0, 3).toUpperCase(), name: home.team.name };
  const state = (game.status || {}).abstractGameState;
  const isLive = state === "Live";
  const showScores = isLive || state === "Final";
  const awayScore = showScores && away.score != null ? away.score : "";
  const homeScore = showScores && home.score != null ? home.score : "";
  const awayWon = state === "Final" && !!away.isWinner;
  const homeWon = state === "Final" && !!home.isWinner;

  return `<div class="gameCard${isLive ? " live" : ""}">
    <div class="gameStatus">${gameStatusLabel(game)}</div>
    <div class="gameTeamRow${awayWon ? " winner" : ""}">
      <span class="gameTeamName"><img src="${logoUrl(away.team)}" alt="" loading="lazy" onerror="this.style.display='none'"><span class="gameTeamAbbr">${awayMeta.abbr}</span></span>
      <span class="gameScore">${awayScore}</span>
    </div>
    <div class="gameTeamRow${homeWon ? " winner" : ""}">
      <span class="gameTeamName"><img src="${logoUrl(home.team)}" alt="" loading="lazy" onerror="this.style.display='none'"><span class="gameTeamAbbr">${homeMeta.abbr}</span></span>
      <span class="gameScore">${homeScore}</span>
    </div>
  </div>`;
}

async function fetchAndRenderScoreboard() {
  const track = document.getElementById("scoreboard-track");
  const dateLabel = document.getElementById("scoreboard-date");
  if (!track) return;
  const dateStr = todayISODate();
  if (dateLabel) {
    const d = new Date(`${dateStr}T12:00:00`);
    dateLabel.innerHTML = `${d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}<br>${d.getDate()}`;
  }
  try {
    const res = await fetch(`${SCHEDULE_BASE}?sportId=1&date=${dateStr}&hydrate=linescore,team`);
    if (!res.ok) throw new Error("schedule request failed");
    const json = await res.json();
    const games = (json.dates && json.dates[0] && json.dates[0].games) || [];
    if (!games.length) {
      track.innerHTML = `<div class="gameCard noGames">No games scheduled today</div>`;
      return;
    }
    track.innerHTML = games.map(renderGameCard).join("");
  } catch (err) {
    console.error(err);
    track.innerHTML = `<div class="gameCard noGames">Scores unavailable</div>`;
  }
}

function initScoreboardNav() {
  const track = document.getElementById("scoreboard-track");
  const prev = document.getElementById("scoreboard-prev");
  const next = document.getElementById("scoreboard-next");
  if (!track || !prev || !next) return;
  prev.addEventListener("click", () => track.scrollBy({ left: -300, behavior: "smooth" }));
  next.addEventListener("click", () => track.scrollBy({ left: 300, behavior: "smooth" }));
}

function initTabs() {
  const buttons = document.querySelectorAll(".tabPill");
  let historyLoaded = false;
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.getElementById("league-view").hidden = view !== "league";
      document.getElementById("division-view").hidden = view !== "division";
      document.getElementById("history-view").hidden = view !== "history";
      if (view === "history" && !historyLoaded) {
        historyLoaded = true;
        loadHistoryView(document.getElementById("history-date").value);
      }
    });
  });
  document.getElementById("refresh-btn").addEventListener("click", loadAndRender);
}

initTabs();
initHistoryView();
loadAndRender();
initScoreboardNav();
fetchAndRenderScoreboard();
setInterval(fetchAndRenderScoreboard, SCOREBOARD_REFRESH_MS);
