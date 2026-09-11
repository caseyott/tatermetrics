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

/* =========================================================
   Season-series tiebreakers
   MLB's first tiebreaker for a season-ending tie between two teams is their
   head-to-head record. A team clinches that season series as soon as its
   head-to-head win total can no longer be caught — either every meeting has
   been played and it leads, or enough have been played that its lead
   exceeds however many meetings remain (so even losing all of them still
   leaves the rival behind). Once a team has clinched the season series, it
   only needs to force (at worst) a tie in the standings against that rival —
   its magic number drops by 1 versus the standard "must finish strictly
   ahead" formula.
   ========================================================= */

function seriesKey(idA, idB) {
  return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
}

/** Pull every regular-season game for the year into a flat, easy-to-aggregate
 *  list. Cancelled games (no makeup will ever happen) are dropped entirely —
 *  they never count toward a season series. Postponed/suspended games that
 *  still need to be made up are kept with isFinal:false, which is what keeps
 *  a pair's series correctly "not decided yet" until they're actually played.
 *  Known limitation: if MLB reschedules a postponed game under a brand-new
 *  gamePk rather than updating the original in place, that game can briefly
 *  double-count toward a series' total — a rare edge case we don't attempt
 *  to fully untangle here. */
async function fetchSeasonGames() {
  try {
    const year = easternDateString().slice(0, 4);
    const res = await fetch(`${SCHEDULE_BASE}?sportId=1&startDate=${year}-01-01&endDate=${year}-12-31&gameType=R`);
    if (!res.ok) throw new Error("season schedule request failed");
    const json = await res.json();
    const games = [];
    (json.dates || []).forEach((d) => {
      (d.games || []).forEach((game) => {
        const away = game.teams && game.teams.away;
        const home = game.teams && game.teams.home;
        if (!away || !home || !away.team || !home.team) return;
        const status = game.status || {};
        if (status.detailedState === "Cancelled") return;
        const isFinal = status.abstractGameState === "Final";
        let winnerId = null;
        if (isFinal) {
          if (away.isWinner) winnerId = away.team.id;
          else if (home.isWinner) winnerId = home.team.id;
        }
        games.push({
          awayId: away.team.id,
          homeId: home.team.id,
          date: game.officialDate || d.date || "",
          isFinal,
          winnerId,
        });
      });
    });
    return games;
  } catch (err) {
    console.error(err);
    return [];
  }
}

// Cached across the "By Date" tab's date-picker changes so switching dates
// doesn't refetch the whole season's schedule each time; the live/refresh
// path always forces a fresh fetch since today's games are still in motion.
let seasonGamesCache = null;
async function getSeasonGames(forceRefresh) {
  if (!seasonGamesCache || forceRefresh) seasonGamesCache = await fetchSeasonGames();
  return seasonGamesCache;
}

/** Aggregate the flat game list into a head-to-head map, counting only games
 *  on or before `cutoffDate` (a "YYYY-MM-DD" string) as decided — pass null
 *  to count every game currently marked Final, i.e. "as of right now". This
 *  lets the same season schedule serve both the live grid (no cutoff) and
 *  the "By Date" tab (cutoff = the day before the selected snapshot, since a
 *  snapshot represents standings before that day's games). */
function buildSeasonSeriesMap(games, cutoffDate) {
  const map = {};
  games.forEach((g) => {
    const key = seriesKey(g.awayId, g.homeId);
    if (!map[key]) map[key] = { total: 0, final: 0, wins: {} };
    const rec = map[key];
    rec.total++;
    const withinCutoff = !cutoffDate || g.date <= cutoffDate;
    if (g.isFinal && withinCutoff) {
      rec.final++;
      if (g.winnerId != null) rec.wins[g.winnerId] = (rec.wins[g.winnerId] || 0) + 1;
    }
  });
  return map;
}

/** Which of idA/idB currently holds the season-series tiebreaker over the
 *  other — null if the outcome isn't locked in yet, or if it ends up split
 *  evenly (a genuine tie, which falls to a later tiebreaker this site
 *  doesn't model). A team is credited as soon as its head-to-head lead is
 *  larger than the number of meetings still to be played, so this can fire
 *  before every game between the two teams has actually happened — e.g. a
 *  team up 7-4 with 2 head-to-head games left has clinched, since the rival
 *  can reach at best 6. */
function seasonSeriesWinner(seriesMap, idA, idB) {
  const rec = seriesMap && seriesMap[seriesKey(idA, idB)];
  if (!rec || rec.total === 0) return null;
  const winsA = rec.wins[idA] || 0;
  const winsB = rec.wins[idB] || 0;
  const remaining = rec.total - rec.final;
  if (winsA > winsB + remaining) return idA;
  if (winsB > winsA + remaining) return idB;
  return null;
}

/** Magic number for `a` to eliminate `b` from finishing ahead of them:
 *  standard formula requires `a` to finish strictly ahead (the +1). If `a`
 *  has already clinched the season series over `b` (see seasonSeriesWinner
 *  above), `a` only needs to force a tie in the loss column, since `a` would
 *  win that tie — so the +1 is dropped. `seriesMap` is optional; omitting it
 *  (or passing one where the series isn't decided) falls back to the
 *  standard formula. */
function magicNumber(a, b, seriesMap) {
  const base = SEASON_TOTAL_GAMES - a.wins - b.losses;
  const ownsTiebreaker = seasonSeriesWinner(seriesMap, a.id, b.id) === a.id;
  return ownsTiebreaker ? base : base + 1;
}

/* =========================================================
   Team detail modal — magic numbers for every clinching scenario
   (1st/2nd seed, division, and each individual wild-card slot).
   See initTeamModal() further down for the click wiring.
   ========================================================= */

// Whichever teams array is currently on screen (live standings, or a
// snapshot/date-compare set from the "By Date" tab) — kept up to date by
// loadAndRender()/loadHistoryView() so a click on any table's team cell can
// look up that team's full record no matter which tab is active. seriesMap
// travels alongside it so the modal's numbers match whichever tab/date the
// click came from (live "as of now", or "as of the day before" a snapshot).
let scenarioContext = { teams: [], seriesMap: {} };

/* =========================================================
   Tragic (elimination) number toggle
   Flips every grid cell between the standard "magic number" framing and
   the "tragic number" framing (see renderMatrixCell above) — purely a
   display switch, so re-rendering on toggle just replays whichever data
   was last fetched rather than hitting the network again.
   ========================================================= */
let tragicMode = false;
let liveRenderCache = null; // {teams, prevTeams, resultsMap, seriesMap} from the last loadAndRender()
let historyRenderCache = null; // {teams, compare, resultsMap, seriesMap} from the last loadHistoryView()

function rerenderGrids() {
  if (liveRenderCache) {
    const { teams, prevTeams, resultsMap, seriesMap } = liveRenderCache;
    document.getElementById("league-view").innerHTML = renderLeagueView(teams, prevTeams, null, resultsMap, seriesMap, tragicMode);
    document.getElementById("division-view").innerHTML = renderDivisionView(teams, prevTeams, null, resultsMap, seriesMap, tragicMode);
  }
  if (historyRenderCache) {
    const { teams, compare, resultsMap, seriesMap } = historyRenderCache;
    document.getElementById("history-league").innerHTML =
      '<h2 class="historySectionTitle">League Standings</h2>' + renderLeagueView(teams, null, compare, resultsMap, seriesMap, tragicMode);
    document.getElementById("history-division").innerHTML =
      '<h2 class="historySectionTitle">Division Standings</h2>' + renderDivisionView(teams, null, compare, resultsMap, seriesMap, tragicMode);
  }
}

function initTragicToggle() {
  const toggle = document.getElementById("tragic-toggle");
  const note = document.getElementById("legend-tragic-note");
  if (!toggle) return;
  toggle.addEventListener("change", () => {
    tragicMode = toggle.checked;
    if (note) note.hidden = !tragicMode;
    rerenderGrids();
  });
}

/** Every other team in `team`'s own division — rivals for the division race. */
function divisionRivals(team, allTeams) {
  return allTeams.filter((t) => t.divisionId === team.divisionId && t.id !== team.id);
}

/** The current leader of each of the OTHER two divisions in `team`'s league —
 *  the rivals for the #1/#2 overall-seed races, since only division winners
 *  can hold those two seeds. */
function otherDivisionLeaders(team, allTeams) {
  return allTeams.filter((t) => t.leagueId === team.leagueId && t.divisionId !== team.divisionId && t.divisionRank === 1);
}

/** Every team in `team`'s league that is NOT currently leading its division —
 *  i.e. the pool competing for the league's 3 wild-card berths. */
function wildCardPool(team, allTeams) {
  return allTeams.filter((t) => t.leagueId === team.leagueId && t.divisionRank !== 1);
}

/** Generalized magic number for `team` to finish `rank`-th or better among
 *  itself plus `rivals` (a group of rivals.length + 1 teams total).
 *
 *  Guaranteeing 1st (beat everyone) takes clinching against every rival —
 *  the largest individual head-to-head magic number in the group. Guaranteeing
 *  rank K or better only requires clinching against all but (group size - K)
 *  of them, since it's fine if that many rivals are still mathematically
 *  alive. Sorting each rival's magic number descending and taking the K-th
 *  entry gives exactly that: K=1 is the max (beat everyone); larger K relaxes
 *  toward the easier rivals. This is the same head-to-head formula already
 *  used for every cell in the grid, just combined across a rival group. */
function groupMagicNumber(team, rivals, rank, seriesMap) {
  if (rivals.length === 0) return 0;
  const sorted = rivals.map((r) => magicNumber(team, r, seriesMap)).sort((a, b) => b - a);
  const idx = Math.min(rank, sorted.length) - 1;
  return Math.max(0, sorted[idx]);
}

function scenarioResult(label, clinched, eliminated, number, notApplicable, naReason) {
  if (notApplicable) return { label, state: "na", display: naReason || "N/A" };
  if (clinched) return { label, state: "clinched", display: "Clinched" };
  if (eliminated) return { label, state: "eliminated", display: "Eliminated" };
  return { label, state: "number", display: String(number) };
}

/** Build the 7 clinching-scenario rows for the team detail modal. Division
 *  clinch/elimination — and the overall playoff-berth clinch — reuse MLB's
 *  own official flags (same ones the grid's status tags/row shading already
 *  rely on); the seed and individual wild-card-slot numbers have no official
 *  equivalent from the Stats API, so those are TaterMetrics' own estimates
 *  from groupMagicNumber() above, based on today's division/wild-card
 *  leaders — they can shift as those races develop, same as any magic number
 *  can. */
function computeScenarios(team, allTeams, seriesMap) {
  const divRivals = divisionRivals(team, allTeams);
  const divisionMN = groupMagicNumber(team, divRivals, 1, seriesMap);
  const divEliminated = isEliminated(team.eliminationNumber);

  const leaders = otherDivisionLeaders(team, allTeams);
  const seed1MN = Math.max(divisionMN, groupMagicNumber(team, leaders, 1, seriesMap));
  const seed2MN = Math.max(divisionMN, groupMagicNumber(team, leaders, 2, seriesMap));

  const leadingDivision = team.divisionRank === 1;
  const pool = leadingDivision ? [] : wildCardPool(team, allTeams).filter((t) => t.id !== team.id);
  const wcEliminated = isEliminated(team.wildCardEliminationNumber);
  const wc1MN = groupMagicNumber(team, pool, 1, seriesMap);
  const wc2MN = groupMagicNumber(team, pool, 2, seriesMap);
  const wc3MN = groupMagicNumber(team, pool, 3, seriesMap);
  const naReason = `N/A — leading ${team.divisionName}`;

  // Overall postseason-berth number: a team is in October as soon as it can
  // no longer finish outside the league's top 6 (3 division winners + 3 wild
  // cards) — i.e. it can't be caught by more than 5 of its 14 leaguemates.
  // That's the same groupMagicNumber() used for every other scenario row,
  // just with the whole league as the rival pool and rank=6.
  //
  // This used to be computed as min(divisionMN, top-3-of-the-non-leader-pool)
  // — "clinch the division OR clinch a wild-card spot" — which double-counts
  // the division-leader pool's own toughness: a comfortable division leader
  // (like a team up big in its division) got its berth number capped by how
  // close the *3rd*-best wild-card contender was, even though a leader that
  // safe would fall back on a wild card long before 3 other teams catch it.
  // The actual bottleneck for a leader that far ahead is whichever single
  // rival sits 6th overall (the first team currently out of the playoff
  // picture) — using the full-league rank=6 pool fixes that. `clinched`/
  // `divisionChamp` below are MLB's own official postseason flags, same as
  // the Division row reuses divisionChamp/eliminationNumber.
  const leagueRivals = allTeams.filter((t) => t.leagueId === team.leagueId && t.id !== team.id);
  const berthMN = groupMagicNumber(team, leagueRivals, 6, seriesMap);
  const berthEliminated = divEliminated && wcEliminated;
  const berthClinched = team.divisionChamp || team.clinched;

  return [
    scenarioResult("Clinch Playoff Berth", berthClinched, berthEliminated, berthMN),
    scenarioResult("Clinch 1st Seed", team.divisionChamp && seed1MN <= 0, divEliminated, seed1MN),
    scenarioResult("Clinch 2nd Seed / skip 1st round", team.divisionChamp && seed2MN <= 0, divEliminated, seed2MN),
    scenarioResult("Clinch Division", team.divisionChamp, divEliminated, divisionMN),
    scenarioResult("Clinch Wild Card #1", !leadingDivision && wc1MN <= 0, wcEliminated, wc1MN, leadingDivision, naReason),
    scenarioResult("Clinch Wild Card #2", !leadingDivision && wc2MN <= 0, wcEliminated, wc2MN, leadingDivision, naReason),
    scenarioResult("Clinch Wild Card #3", !leadingDivision && (team.clinched || wc3MN <= 0), wcEliminated, wc3MN, leadingDivision, naReason),
  ];
}

function findTeamById(id) {
  return scenarioContext.teams.find((t) => t.id === id) || null;
}

function scenarioRowHtml(result) {
  return `<div class="scenarioRow scenario-${result.state}"><span class="scenarioLabel">${result.label}</span><span class="scenarioValue">${result.display}</span></div>`;
}

function openTeamModal(teamId) {
  const team = findTeamById(teamId);
  if (!team) return;
  const scenarios = computeScenarios(team, scenarioContext.teams, scenarioContext.seriesMap);
  document.getElementById("team-modal-logo").src = logoUrl(team);
  document.getElementById("team-modal-title").textContent = team.name;
  document.getElementById("team-modal-record").textContent = `${team.wins}-${team.losses} (${team.pctDisplay}) · ${team.divisionName}`;
  document.getElementById("team-modal-body").innerHTML = scenarios.map(scenarioRowHtml).join("");
  const modal = document.getElementById("team-modal");
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeTeamModal() {
  const modal = document.getElementById("team-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

/** Wires up every team cell across all 3 tabs (League/Division/By Date) to
 *  open the scenarios modal on click — via delegation on `document`, since
 *  the tables are re-rendered (innerHTML replaced) on every refresh/tab
 *  switch and per-cell listeners would be lost each time. */
function initTeamModal() {
  document.addEventListener("click", (e) => {
    const cell = e.target.closest(".team-cell[data-team-id]");
    if (cell) {
      openTeamModal(Number(cell.dataset.teamId));
      return;
    }
    if (e.target.closest("#team-modal-close") || e.target.id === "team-modal") {
      closeTeamModal();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeTeamModal();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const active = document.activeElement;
      if (active && active.matches(".team-cell[data-team-id]")) {
        e.preventDefault();
        openTeamModal(Number(active.dataset.teamId));
      }
    }
  });
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
function magicNumberDelta(rowTeam, colTeam, otherTeams, seriesMap) {
  if (!otherTeams) return null;
  const otherRow = otherTeams[rowTeam.id];
  const otherCol = otherTeams[colTeam.id];
  if (!otherRow || !otherCol) return null;
  const ownsTiebreaker = seasonSeriesWinner(seriesMap, rowTeam.id, colTeam.id) === rowTeam.id;
  const otherMn = SEASON_TOTAL_GAMES - otherRow.wins - otherCol.losses + (ownsTiebreaker ? 0 : 1);
  return otherMn - magicNumber(rowTeam, colTeam, seriesMap);
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
  // Positive delta means the comparison point has the more favorable number
  // (more wins, fewer losses, smaller magic number) than the displayed date —
  // i.e. things improved between the two, so that reads as "better" (green).
  const better = delta < 0;
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
    const [snapshot, resultsMap, seasonGames] = await Promise.all([
      fetchSnapshotForDate(dateStr),
      fetchResultsMap(dateStr),
      getSeasonGames(false),
    ]);
    if (!snapshot) {
      setHistoryStatus(`No snapshot found for ${dateStr} yet.`, true);
      return;
    }
    const teams = teamsFromSnapshot(snapshot);
    // A snapshot represents standings before that day's games (see the
    // historyNote below), so a series only counts as decided as of the day
    // before it — a game played ON dateStr shouldn't count yet.
    const seriesMap = buildSeasonSeriesMap(seasonGames, addDays(dateStr, -1));
    scenarioContext.teams = teams;
    scenarioContext.seriesMap = seriesMap;

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

    historyRenderCache = { teams, compare, resultsMap, seriesMap };
    document.getElementById("history-league").innerHTML =
      '<h2 class="historySectionTitle">League Standings</h2>' + renderLeagueView(teams, null, compare, resultsMap, seriesMap, tragicMode);
    document.getElementById("history-division").innerHTML =
      '<h2 class="historySectionTitle">Division Standings</h2>' + renderDivisionView(teams, null, compare, resultsMap, seriesMap, tragicMode);
    setHistoryStatus(compareError, !!compareError);
  } catch (err) {
    console.error(err);
    setHistoryStatus(`Couldn't load the snapshot for ${dateStr}.`, true);
  }
}

/** The most recent date (ET) that actually has a snapshot file, walking
 *  backward a few days in case this morning's cron hasn't landed yet (same
 *  fallback fetchLatestSnapshot uses for the live "since this morning"
 *  comparison). Falls back to today's date outright if nothing in the
 *  lookback window is found, so the selector always gets a value. */
async function findLatestAvailableSnapshotDate() {
  const todayET = easternDateString();
  for (let back = 0; back <= SNAPSHOT_LOOKBACK_DAYS; back++) {
    const dateStr = addDays(todayET, -back);
    try {
      const res = await fetch(`data/${dateStr}.json`, { cache: "no-store" });
      if (res.ok) return dateStr;
    } catch (err) {
      // this date's file is missing or unreadable — fall back further
    }
  }
  return todayET;
}

async function initHistoryView() {
  const select = document.getElementById("history-date");
  if (!select) return;
  select.innerHTML = historyDateOptions()
    .map((d) => `<option value="${d}">${d}</option>`)
    .join("");
  // Default to the latest date that actually has a snapshot (usually today,
  // but this falls back if this morning's cron hasn't run/landed yet) so,
  // combined with the default "Compare to Today (live)" below, the initial
  // view is "this morning vs. right now" — the top ("Standings as of") date
  // should default to the one further in the past.
  select.value = await findLatestAvailableSnapshotDate();
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

/** Row class for the Division Standings view: same as statusClass, but also
 *  flags a team as "division-eliminated" when it's mathematically out of the
 *  division race specifically (eliminationNumber <= 0 / "E"), even if it's
 *  still alive for a wild-card spot. Only applied when nothing higher-priority
 *  (clinched-division/clinched-wildcard/fully eliminated) already applies. */
function divisionRowClass(team) {
  const base = statusClass(team);
  if (base) return base;
  return isEliminated(team.eliminationNumber) ? "division-eliminated" : "";
}

function statusTag(cls) {
  if (cls === "clinched-division") return '<span class="status-tag div">DIV</span>';
  if (cls === "clinched-wildcard") return '<span class="status-tag wc">WC</span>';
  if (cls === "eliminated") return '<span class="status-tag elim">E</span>';
  if (cls === "division-eliminated") return '<span class="status-tag divelim">DIV-E</span>';
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

/** Renders one grid cell for the pair (rowTeam, colTeam). In magic-number
 *  mode (tragic=false), a cell only has a number when rowTeam currently
 *  leads colTeam — the number is rowTeam's own magic number over colTeam.
 *  In tragic-number mode, the same pair is read from the trailing side
 *  instead: a cell has a number when colTeam currently leads rowTeam, and
 *  that number is rowTeam's elimination number against colTeam — which is
 *  just colTeam's magic number over rowTeam (magicNumber(colTeam, rowTeam)),
 *  i.e. the exact value that would appear in this pair's OTHER cell in magic
 *  mode. Flipping the toggle never changes any underlying math, only which
 *  of the two directions a given cell reports. */
function renderMatrixCell(rowTeam, colTeam, prevTeams, compare, seriesMap, tragic) {
  if (rowTeam.id === colTeam.id) {
    return `<td class="diag"><img class="team-logo-diag" src="${logoUrl(rowTeam)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>`;
  }
  const leader = tragic ? colTeam : rowTeam;
  const trailer = tragic ? rowTeam : colTeam;
  if (!isAheadOf(leader, trailer)) {
    return tragic ? '<td class="ne">NE</td>' : '<td class="nc">NC</td>';
  }
  const cellCls = tragic ? "tragic-num" : "magic-num";
  const num = magicNumber(leader, trailer, seriesMap);
  if (num <= 0) {
    return tragic ? `<td class="${cellCls} elim">E</td>` : `<td class="${cellCls}">&ndash;</td>`;
  }
  const statLabel = tragic ? "Elimination number" : "Magic number";
  if (compare) {
    const delta = magicNumberDelta(leader, trailer, compare.teams, seriesMap);
    return diffTd(cellCls, num, delta, compare.label, statLabel);
  }
  const delta = magicNumberDelta(leader, trailer, prevTeams, seriesMap);
  let cls = cellCls;
  let badge = "";
  if (delta === 1) {
    cls += " mn-down1";
    badge = '<span class="mn-arrow" title="down 1 since this morning\'s snapshot">&#9660;</span>';
  } else if (delta !== null && delta >= 2) {
    cls += " mn-down2";
    badge = `<span class="mn-arrow mn-arrow-double" title="down ${delta} since this morning's snapshot (doubleheader?)"><i class="ti ti-chevron-down" aria-hidden="true"></i><i class="ti ti-chevron-down" aria-hidden="true"></i></span>`;
  }
  return `<td class="${cls}">${num}${badge}</td>`;
}

function resultBadge(team, resultsMap) {
  const result = resultsMap && resultsMap[team.id];
  if (!result) return "";
  const cls = result === "W" ? "win" : "loss";
  const title = result === "W" ? "Won that day's game" : "Lost that day's game";
  return `<span class="result-badge ${cls}" title="${title}">${result}</span>`;
}

function teamCell(team, showFullName, resultsMap, rowCls) {
  const nameSpan = showFullName ? `<span class="team-name">${team.shortName}</span>` : "";
  // The result badge sits outside .team-cell-main, inside the .team-cell-inner
  // flex wrapper, so it pins to the right edge of the column instead of
  // drifting based on how long the name to its left happens to be. The <td>
  // itself stays a plain table-cell (see .team-cell-inner in style.css) so
  // row-height/border alignment with the rest of the row isn't disturbed.
  // data-team-id + tabindex/role make the cell clickable/keyboard-operable
  // so it can open the clinching-scenarios modal (see initTeamModal below).
  return `<td class="team-cell" data-team-id="${team.id}" tabindex="0" role="button" aria-label="Clinching scenarios for ${team.name}" title="${team.name}"><span class="team-cell-inner"><span class="team-cell-main"><img class="team-logo" src="${logoUrl(team)}" alt="" loading="lazy" onerror="this.style.display='none'">${team.abbr}${statusTag(rowCls)}${nameSpan}</span>${resultBadge(team, resultsMap)}</span></td>`;
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
    const cls = opts.showDivElim ? divisionRowClass(team) : statusClass(team);
    const divider = dividerAfter[i + 1] || "";
    body += `<tr class="${[cls, divider].filter(Boolean).join(" ")}">`;
    body += teamCell(team, showFullName, opts.resultsMap, cls);
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
      body += renderMatrixCell(team, col, opts.prevTeams, compare, opts.seriesMap, opts.tragic);
    });
    body += "</tr>";
  });

  const colgroup = buildColgroup(columns.length, numStatCols);
  return `<div class="table-scroll"><table class="standings">${colgroup}<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderLeagueView(teams, prevTeams, compare, resultsMap, seriesMap, tragic) {
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
      seriesMap,
      tragic,
    });
    html += "</div>";
  });
  return html;
}

function renderDivisionView(teams, prevTeams, compare, resultsMap, seriesMap, tragic) {
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
    html += renderTable(ordered, ordered, { showWcGb: false, gbField: "division", prevTeams, compare, resultsMap, seriesMap, showDivElim: true, tragic });
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
    const [{ teams, lastUpdated }, latestSnapshot, resultsMap, seasonGames] = await Promise.all([
      fetchAllStandings(),
      fetchLatestSnapshot(),
      fetchResultsMap(easternDateString()),
      getSeasonGames(true), // force-refresh: today's games may just have gone Final
    ]);
    const prevTeams = latestSnapshot ? latestSnapshot.teams : null;
    const seriesMap = buildSeasonSeriesMap(seasonGames, null); // no cutoff = as of right now
    scenarioContext.teams = teams;
    scenarioContext.seriesMap = seriesMap;
    liveRenderCache = { teams, prevTeams, resultsMap, seriesMap };
    document.getElementById("league-view").innerHTML = renderLeagueView(teams, prevTeams, null, resultsMap, seriesMap, tragicMode);
    document.getElementById("division-view").innerHTML = renderDivisionView(teams, prevTeams, null, resultsMap, seriesMap, tragicMode);
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

function initTabs(historyReady) {
  const buttons = document.querySelectorAll(".tabPill");
  let historyLoaded = false;
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.getElementById("league-view").hidden = view !== "league";
      document.getElementById("division-view").hidden = view !== "division";
      document.getElementById("history-view").hidden = view !== "history";
      if (view === "history" && !historyLoaded) {
        historyLoaded = true;
        // Wait for the default "Standings as of" date (the latest date that
        // actually has a snapshot) to resolve before doing the first load, so
        // a fast click right after page load can't jump the gun and load the
        // dropdown's fallback first option instead of the intended default.
        await historyReady;
        loadHistoryView(document.getElementById("history-date").value);
      }
    });
  });
  document.getElementById("refresh-btn").addEventListener("click", loadAndRender);
}

initTabs(initHistoryView());
initTeamModal();
initTragicToggle();
loadAndRender();
initScoreboardNav();
fetchAndRenderScoreboard();
setInterval(fetchAndRenderScoreboard, SCOREBOARD_REFRESH_MS);
