/**
 * Builds the final data/qb.json from progress.json's confirmed Spotrac
 * results, filling in every starter QB who doesn't have a confirmed real
 * cap hit yet with a free, clearly-flagged placeholder — so the site
 * always shows all 34 starters' stats, with *some* salary figure, rather
 * than silently dropping anyone still waiting on a real Spotrac lookup.
 *
 * Placeholder tiers, in order of preference:
 *   1. spotrac_cap_hit / spotrac_cash_approx — real, from progress.json
 *   2. nflverse_apy_estimate — that QB's current-contract APY from
 *      nflverse's `contracts` release (free, no API key). Documented in
 *      README.md as too stale to trust as the *primary* salary source,
 *      but still real, sourced data — reasonable as a stand-in until a
 *      real Spotrac lookup happens.
 *   3. placeholder_flat — a QB in neither source at all (typically a
 *      2023+ draft class rookie missing from the nflverse contracts
 *      scrape too). A crude flat estimate, clearly flagged — not meant
 *      to be taken as researched.
 *
 * Every non-tier-1 entry gets salary.isPlaceholder = true.
 */

const { normalizeName } = require("./qbdata");

const PLACEHOLDER_FLAT_VALUE = 2_000_000;

function buildFinalSnapshot(progress, apyMap, meta) {
  const doneByName = new Map(progress.done.map((d) => [d.name, d]));
  const qbs = [];
  const salaryPending = []; // still needs a real Spotrac lookup

  for (const s of progress.starters) {
    const d = doneByName.get(s.name);

    if (d && d.salary) {
      qbs.push({
        name: s.name,
        team: s.team,
        stats: s.stats,
        salary: {
          capHit: d.salary.capHit,
          capPctOfLeagueCap: d.salary.capPctOfLeagueCap,
          source: d.salary.isApprox ? "spotrac_cash_approx" : "spotrac_cap_hit",
        },
      });
      continue;
    }

    salaryPending.push(s.name);
    const apy = apyMap.get(normalizeName(s.name));
    if (apy) {
      qbs.push({
        name: s.name,
        team: s.team,
        stats: s.stats,
        salary: {
          capHit: apy,
          capPctOfLeagueCap: null,
          isPlaceholder: true,
          source: "nflverse_apy_estimate",
          spotracAttemptReason: d ? d.excludedReason : null,
        },
      });
    } else {
      qbs.push({
        name: s.name,
        team: s.team,
        stats: s.stats,
        salary: {
          capHit: PLACEHOLDER_FLAT_VALUE,
          capPctOfLeagueCap: null,
          isPlaceholder: true,
          source: "placeholder_flat",
          spotracAttemptReason: d ? d.excludedReason : null,
        },
      });
    }
  }

  qbs.sort((a, b) => b.salary.capHit - a.salary.capHit);

  return {
    ...meta,
    generatedAt: new Date().toISOString(),
    qbs,
    salaryPending,
  };
}

module.exports = { buildFinalSnapshot, PLACEHOLDER_FLAT_VALUE };
