/**
 * QB Salary vs. Stats — all math happens here, client-side, from the
 * static snapshot at data/qb.json (built by scripts/snapshot.js; see
 * README.md for how that file gets its numbers).
 *
 * Every derived stat, every mean/median, every "overpaid" ranking is
 * computed fresh on page load from that raw {name, team, stats, salary}
 * list — nothing pre-baked into the data file itself.
 */

const DATA_URL = "data/qb.json";

/* =========================================================
   Derived stats
   ========================================================= */

function passerRating(comp, att, yds, td, int) {
  if (!att) return 0;
  const clamp = (n) => Math.max(0, Math.min(2.375, n));
  const a = clamp((comp / att - 0.3) * 5);
  const b = clamp((yds / att - 3) * 0.25);
  const c = clamp((td / att) * 20);
  const d = clamp(2.375 - (int / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

// direction: "higher" = more is better, "lower" = less is better.
// inComposite: included in the 7-stat Value Score average (see README).
const STAT_DEFS = [
  {
    key: "completionPct",
    label: "Comp %",
    unit: "%",
    decimals: 1,
    direction: "higher",
    inComposite: true,
    compute: (s) => (s.attempts ? (s.completions / s.attempts) * 100 : 0),
  },
  {
    key: "passingYards",
    label: "Pass Yds",
    unit: "",
    decimals: 0,
    direction: "higher",
    inComposite: true,
    compute: (s) => s.passingYards,
  },
  {
    key: "passingTds",
    label: "Pass TD",
    unit: "",
    decimals: 0,
    direction: "higher",
    inComposite: false,
    compute: (s) => s.passingTds,
  },
  {
    key: "interceptions",
    label: "INT",
    unit: "",
    decimals: 0,
    direction: "lower",
    inComposite: true,
    compute: (s) => s.interceptions,
  },
  {
    key: "passerRating",
    label: "Rating",
    unit: "",
    decimals: 1,
    direction: "higher",
    inComposite: true,
    compute: (s) => passerRating(s.completions, s.attempts, s.passingYards, s.passingTds, s.interceptions),
  },
  {
    key: "tdIntRatio",
    label: "TD:INT",
    unit: "",
    decimals: 2,
    direction: "higher",
    inComposite: true,
    compute: (s) => s.passingTds / Math.max(1, s.interceptions),
  },
  {
    key: "totalTds",
    label: "Total TD",
    unit: "",
    decimals: 0,
    direction: "higher",
    inComposite: true,
    compute: (s) => s.passingTds + s.rushingTds,
  },
  {
    key: "sacks",
    label: "Sacked",
    unit: "",
    decimals: 0,
    direction: "lower",
    inComposite: true,
    compute: (s) => s.sacks,
  },
  {
    key: "rushingYards",
    label: "Rush Yds",
    unit: "",
    decimals: 0,
    direction: "higher",
    inComposite: false,
    compute: (s) => s.rushingYards,
  },
  {
    key: "rushingTds",
    label: "Rush TD",
    unit: "",
    decimals: 0,
    direction: "higher",
    inComposite: false,
    compute: (s) => s.rushingTds,
  },
  {
    key: "yardsPerGame",
    label: "Yds/Gm",
    unit: "",
    decimals: 1,
    direction: "higher",
    inComposite: false,
    compute: (s) => (s.games ? s.passingYards / s.games : 0),
  },
];
const STAT_BY_KEY = Object.fromEntries(STAT_DEFS.map((d) => [d.key, d]));
const COMPOSITE_KEYS = STAT_DEFS.filter((d) => d.inComposite).map((d) => d.key);

const EXCLUDED_REASON_TEXT = {
  not_found_on_spotrac: "not found on Spotrac",
  no_salary_data_for_year: "no salary data for that season (usually a since-superseded contract)",
  no_cap_hit_row_for_year: "no salary data for that season (usually a since-superseded contract)", // old label, kept for data written before the rename
  not_under_contract_that_year: "not under contract that season (free agent)",
  spotrac_error: "lookup error",
  unknown: "excluded",
};

/* =========================================================
   Stats math
   ========================================================= */

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Competition ranking (1 = best), ties share a rank.
function rankMap(qbs, valueOf, direction) {
  const sorted = [...qbs].sort((a, b) =>
    direction === "lower" ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a)
  );
  const ranks = new Map();
  let rank = 0;
  let prevValue = null;
  sorted.forEach((qb, i) => {
    const v = valueOf(qb);
    if (prevValue === null || v !== prevValue) rank = i + 1;
    ranks.set(qb.name, rank);
    prevValue = v;
  });
  return ranks;
}

function ratioVsBaseline(value, baseline, direction) {
  if (!baseline) return 0;
  const raw = (value - baseline) / baseline;
  return direction === "lower" ? -raw : raw;
}

/**
 * Builds the full computed dataset: every QB gets a `computed` map of
 * stat values, plus salary. Also returns the baseline (mean/median) for
 * salary and every stat, so the UI can recompute ratios/ranks without
 * re-deriving stats every time the baseline toggle flips.
 */
function buildModel(qbs) {
  const computed = qbs.map((qb) => {
    const values = {};
    for (const def of STAT_DEFS) values[def.key] = def.compute(qb.stats);
    return { ...qb, computed: values };
  });

  const salaryValues = computed.map((qb) => qb.salary.capHit);
  const baselines = {
    salary: { mean: mean(salaryValues), median: median(salaryValues) },
  };
  for (const def of STAT_DEFS) {
    const values = computed.map((qb) => qb.computed[def.key]);
    baselines[def.key] = { mean: mean(values), median: median(values) };
  }

  return { qbs: computed, baselines };
}

/** Per-stat overpaid index for one QB, given a baseline ("mean"|"median"). */
function overpaidIndexForStat(qb, statKey, baselines, baseline) {
  const def = STAT_BY_KEY[statKey];
  const salaryRatio = ratioVsBaseline(qb.salary.capHit, baselines.salary[baseline], "higher");
  const statRatio = ratioVsBaseline(qb.computed[statKey], baselines[statKey][baseline], def.direction);
  return salaryRatio - statRatio;
}

/** Composite Value Score: average overpaid index across the core 7 stats. */
function valueScore(qb, baselines, baseline) {
  const indices = COMPOSITE_KEYS.map((key) => overpaidIndexForStat(qb, key, baselines, baseline));
  return mean(indices);
}

function verdictFor(index) {
  if (index > 0.15) return { label: "Overpaid", cls: "pillRed" };
  if (index < -0.15) return { label: "Underpaid", cls: "pillGreen" };
  return { label: "Fair Value", cls: "pillAmber" };
}

/* =========================================================
   Formatting
   ========================================================= */

function fmtMoney(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtNum(n, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtSigned(n, decimals = 2) {
  const s = fmtNum(Math.abs(n), decimals);
  return (n < 0 ? "−" : "+") + s;
}

function fmtPct(n, decimals = 1) {
  return fmtNum(n, decimals) + "%";
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/* =========================================================
   App state + rendering
   ========================================================= */

const state = {
  view: "value", // "value" | "stat" | "raw"
  statKey: "passingTds",
  baseline: "mean", // "mean" | "median"
  sort: { key: null, dir: "desc" },
  data: null, // { qbs, baselines, meta }
};

function el(id) {
  return document.getElementById(id);
}

function setStatusBanner(data) {
  const pending = data.salaryPending || [];
  const banner = el("status-banner");
  if (pending.length > 0) {
    const real = data.qbs.length - pending.length;
    banner.hidden = false;
    banner.classList.remove("complete");
    el("status-banner-text").innerHTML =
      `All ${data.qbs.length} starter QBs' stats are loaded. <strong>${real} have a confirmed real salary</strong>; ` +
      `the other <strong>${pending.length}</strong> are showing a placeholder (marked <span class="placeholderCap" title="estimate">~</span>/<span class="placeholderCap" title="no data">?</span> in the Cap Hit column, or &asymp; for an approximate figure) until a real Spotrac lookup happens. ` +
      `<span class="statusDetail">Rankings below use whatever salary figure is currently shown for each QB, real or placeholder.</span>`;
  } else {
    banner.hidden = true;
  }
}

function setExcludedList(data) {
  const details = el("excluded-details");
  const pending = data.salaryPending || [];
  if (!pending.length) {
    details.hidden = true;
    return;
  }
  details.hidden = false;
  const byName = new Map(data.qbs.map((qb) => [qb.name, qb]));
  el("excluded-list").innerHTML = pending
    .map((name) => {
      const qb = byName.get(name);
      const reason = qb && qb.salary.spotracAttemptReason;
      const title = reason
        ? `Spotrac lookup already tried once: ${EXCLUDED_REASON_TEXT[reason] || reason}`
        : "No Spotrac lookup attempted yet";
      return `<span class="excludedTag" title="${title}">${name}</span>`;
    })
    .join("");
}

function populateStatPicker() {
  const picker = el("stat-picker");
  picker.innerHTML = STAT_DEFS.map((d) => `<option value="${d.key}">${d.label}</option>`).join("");
  picker.value = state.statKey;
}

function columnsForView() {
  if (state.view === "value") {
    return [
      { key: "rank", label: "#", cls: "rankCell", sortable: false },
      { key: "name", label: "QB", cls: "nameCell", sortable: true },
      { key: "capHit", label: "Cap Hit", sortable: true },
      { key: "capPct", label: "% Cap", sortable: true },
      { key: "valueScore", label: "Value Score", sortable: true },
      { key: "verdict", label: "Verdict", sortable: false },
    ];
  }
  if (state.view === "stat") {
    const def = STAT_BY_KEY[state.statKey];
    return [
      { key: "rank", label: "#", cls: "rankCell", sortable: false },
      { key: "name", label: "QB", cls: "nameCell", sortable: true },
      { key: "capHit", label: "Cap Hit", sortable: true },
      { key: "statValue", label: def.label, sortable: true },
      { key: "statRank", label: "Stat Rank", sortable: true },
      { key: "salaryRank", label: "Pay Rank", sortable: true },
      { key: "overpaidIndex", label: "Overpaid Index", sortable: true },
      { key: "verdict", label: "Verdict", sortable: false },
    ];
  }
  // raw
  return [
    { key: "name", label: "QB", cls: "nameCell", sortable: true },
    { key: "games", label: "GP", sortable: true },
    { key: "completions", label: "Comp", sortable: true },
    { key: "attempts", label: "Att", sortable: true },
    { key: "completionPct", label: "Comp %", sortable: true },
    { key: "passingYards", label: "Pass Yds", sortable: true },
    { key: "yardsPerGame", label: "Yds/Gm", sortable: true },
    { key: "passingTds", label: "Pass TD", sortable: true },
    { key: "interceptions", label: "INT", sortable: true },
    { key: "tdIntRatio", label: "TD:INT", sortable: true },
    { key: "passerRating", label: "Rating", sortable: true },
    { key: "rushingYards", label: "Rush Yds", sortable: true },
    { key: "rushingTds", label: "Rush TD", sortable: true },
    { key: "sacks", label: "Sacked", sortable: true },
    { key: "capHit", label: "Cap Hit", sortable: true },
    { key: "capPct", label: "% Cap", sortable: true },
  ];
}

function buildRows() {
  const { qbs, baselines } = state.data;
  const baseline = state.baseline;

  if (state.view === "value") {
    const salaryRanks = rankMap(qbs, (qb) => qb.salary.capHit, "higher");
    const rows = qbs.map((qb) => ({
      qb,
      name: qb.name,
      team: qb.team,
      capHit: qb.salary.capHit,
      capPct: qb.salary.capPctOfLeagueCap,
      isApprox: qb.salary.isApprox,
      isPlaceholder: qb.salary.isPlaceholder,
      salarySource: qb.salary.source,
      valueScore: valueScore(qb, baselines, baseline),
      salaryRank: salaryRanks.get(qb.name),
    }));
    if (!state.sort.key) state.sort = { key: "valueScore", dir: "desc" };
    return rows;
  }

  if (state.view === "stat") {
    const def = STAT_BY_KEY[state.statKey];
    const statRanks = rankMap(qbs, (qb) => qb.computed[state.statKey], def.direction);
    const salaryRanks = rankMap(qbs, (qb) => qb.salary.capHit, "higher");
    const overpaidRanks = rankMap(
      qbs,
      (qb) => overpaidIndexForStat(qb, state.statKey, baselines, baseline),
      "higher"
    );
    const rows = qbs.map((qb) => ({
      qb,
      name: qb.name,
      team: qb.team,
      capHit: qb.salary.capHit,
      isApprox: qb.salary.isApprox,
      isPlaceholder: qb.salary.isPlaceholder,
      salarySource: qb.salary.source,
      statValue: qb.computed[state.statKey],
      statRank: statRanks.get(qb.name),
      salaryRank: salaryRanks.get(qb.name),
      overpaidIndex: overpaidIndexForStat(qb, state.statKey, baselines, baseline),
      overpaidRank: overpaidRanks.get(qb.name),
    }));
    if (!state.sort.key) state.sort = { key: "overpaidIndex", dir: "desc" };
    return rows;
  }

  // raw
  const rows = qbs.map((qb) => ({
    qb,
    name: qb.name,
    team: qb.team,
    games: qb.stats.games,
    completions: qb.stats.completions,
    attempts: qb.stats.attempts,
    capHit: qb.salary.capHit,
    capPct: qb.salary.capPctOfLeagueCap,
    isApprox: qb.salary.isApprox,
    ...qb.computed,
  }));
  if (!state.sort.key) state.sort = { key: "capHit", dir: "desc" };
  return rows;
}

function sortRows(rows) {
  const { key, dir } = state.sort;
  if (!key) return rows;
  const sorted = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string") return av.localeCompare(bv);
    return av - bv;
  });
  if (dir === "desc") sorted.reverse();
  return sorted;
}

function cellHtml(colKey, row) {
  switch (colKey) {
    case "name":
      return `${row.name}<span class="teamTag">${row.team}</span>`;
    case "capHit": {
      if (row.isApprox) {
        return `<span title="No cap-hit table covers this season (usually a since-superseded contract) — this is cash actually paid that year instead, from Spotrac's earnings history.">&asymp; ${fmtMoney(row.capHit)}</span>`;
      }
      if (row.salarySource === "nflverse_apy_estimate") {
        return `<span class="placeholderCap" title="No confirmed Spotrac data yet — this is that contract's average-per-year value from nflverse's contracts dataset, which can be stale for deals signed/renegotiated in the last few years. Treat as a rough estimate.">~ ${fmtMoney(row.capHit)}</span>`;
      }
      if (row.salarySource === "placeholder_flat") {
        return `<span class="placeholderCap" title="No real salary data found anywhere for this QB yet (common for very recent rookie contracts) — this is a generic placeholder, not a researched figure.">? ${fmtMoney(row.capHit)}</span>`;
      }
      return fmtMoney(row.capHit);
    }
    case "capPct":
      return row.capPct != null ? fmtPct(row.capPct) : "&mdash;";
    case "valueScore":
      return fmtSigned(row.valueScore, 3);
    case "overpaidIndex":
      return fmtSigned(row.overpaidIndex, 3);
    case "statRank":
    case "salaryRank":
      return "#" + row[colKey];
    case "verdict": {
      const idx = row.valueScore ?? row.overpaidIndex;
      const v = verdictFor(idx);
      return `<span class="pill ${v.cls}">${v.label}</span>`;
    }
    case "statValue": {
      const def = STAT_BY_KEY[state.statKey];
      return fmtNum(row.statValue, def.decimals) + def.unit;
    }
    default: {
      const def = STAT_BY_KEY[colKey];
      if (def) return fmtNum(row[colKey], def.decimals) + def.unit;
      if (typeof row[colKey] === "number") return fmtNum(row[colKey]);
      return row[colKey] ?? "";
    }
  }
}

function render() {
  const columns = columnsForView();
  let rows = buildRows();
  rows = sortRows(rows);

  const thead = el("qb-table-head");
  thead.innerHTML =
    "<tr>" +
    columns
      .map((c) => {
        const sorted = state.sort.key === c.key;
        const arrow = sorted ? (state.sort.dir === "desc" ? "▼" : "▲") : "";
        const cls = [c.cls, sorted ? "sorted" : ""].filter(Boolean).join(" ");
        return `<th class="${cls}" data-key="${c.key}" data-sortable="${c.sortable}">${c.label}${
          c.sortable ? `<span class="sortArrow">${arrow || "▼"}</span>` : ""
        }</th>`;
      })
      .join("") +
    "</tr>";

  const tbody = el("qb-table-body");
  tbody.innerHTML = rows
    .map((row, i) => {
      const cells = columns
        .map((c) => {
          const cls = c.cls ? ` class="${c.cls}"` : "";
          const value = c.key === "rank" ? `${i + 1}` : cellHtml(c.key, row);
          return `<td${cls}>${value}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  thead.querySelectorAll('th[data-sortable="true"]').forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "desc" ? "asc" : "desc";
      } else {
        state.sort = { key, dir: "desc" };
      }
      render();
    });
  });
}

function wireControls() {
  el("view-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tabPill");
    if (!btn) return;
    document.querySelectorAll("#view-tabs .tabPill").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.view = btn.dataset.view;
    state.sort = { key: null, dir: "desc" };
    el("stat-picker-group").hidden = state.view !== "stat";
    render();
  });

  el("stat-picker").addEventListener("change", (e) => {
    state.statKey = e.target.value;
    state.sort = { key: null, dir: "desc" };
    render();
  });

  el("baseline-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    document.querySelectorAll("#baseline-toggle button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.baseline = btn.dataset.baseline;
    render();
  });
}

async function main() {
  wireControls();
  populateStatPicker();

  let data;
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    el("load-error").hidden = false;
    el("load-error").textContent =
      "Couldn't load data/qb.json yet — the data pipeline may not have run yet. See README.md.";
    return;
  }

  if (!data.qbs || data.qbs.length === 0) {
    el("load-error").hidden = false;
    el("load-error").textContent = "No QBs loaded yet — the data pipeline hasn't produced results yet.";
    return;
  }

  el("stats-season-label").textContent = `${data.statsSeason}`;
  el("min-games-label").textContent = data.minGames;
  el("min-attempts-label").textContent = data.minAttempts;
  el("generated-at-note").innerHTML =
    `Stats: ${data.statsSeason} regular season (nflverse). Salary: ${data.salaryYear} cap hit (Spotrac). ` +
    `Snapshot generated ${fmtDate(data.generatedAt)}.`;
  el("last-updated").textContent = `Data snapshot: ${fmtDate(data.generatedAt)}`;

  setStatusBanner(data);
  setExcludedList(data);

  const model = buildModel(data.qbs);
  state.data = model;
  el("table-section").hidden = false;

  render();
}

main();
