/* civicAPI adapter: turns a civicAPI v2 race into the county-race shape the engine reads.
   Shared by the page (browser) and the blurb job (Node). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CTCivic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const API = 'https://civicapi.org/api/v2/race/';

  function partyCode(p) {
    const s = String(p || '').toLowerCase();
    if (s.startsWith('dem')) return 'DEM';
    if (s.startsWith('rep')) return 'REP';
    if (s.startsWith('lib')) return 'LIB';
    if (s.startsWith('green')) return 'GRN';
    if (s.startsWith('ind') || s.startsWith('no party') || s.startsWith('npa') || s.startsWith('unaff')) return 'IND';
    return 'OTH';
  }

  // Map races.json entries to County Targets geography/race keys: GA-SEN, GA-GOV, IA-01, ...
  function raceKeyFor(r) {
    const n = String(r.name || '').toLowerCase();
    if (n.startsWith('us senate')) return `${r.state}-SEN`;
    if (n === 'governor') return `${r.state}-GOV`;
    const m = n.match(/^us house (\d+)/);
    if (m) return `${r.state}-${String(m[1]).padStart(2, '0')}`;
    return null;
  }
  function buildIndex(racesJson) {
    const idx = {};
    for (const r of (racesJson && racesJson.races) || []) {
      const k = raceKeyFor(r);
      if (k && !idx[k]) idx[k] = r.id;
    }
    return idx;
  }

  function toRace(j, raceKey) {
    if (!j) return null;
    const cands = (j.candidates || []).map(c => ({ name: c.name, party: partyCode(c.party), winner: !!c.winner }));
    const counties = [];
    for (const reg of Object.values(j.region_results || {})) {
      if (!reg || !reg.fips) continue;
      const votes = {};
      for (const c of reg.candidates || []) votes[c.name] = +c.votes || 0;
      const pr = reg.percent_reporting;
      counties.push({
        fips: String(reg.fips).padStart(5, '0'), name: reg.name, votes,
        total_votes: Object.values(votes).reduce((a, b) => a + b, 0),
        precincts_reporting: pr == null ? null : +pr, precincts_total: pr == null ? null : 100, pct_basis: true
      });
    }
    // percent_reporting may arrive as 0-1 or 0-100: normalize to 0-100
    const prs = counties.map(c => c.precincts_reporting).filter(x => x != null);
    if (prs.length && Math.max(...prs) <= 1 && prs.some(x => x > 0)) counties.forEach(c => { if (c.precincts_reporting != null) c.precincts_reporting *= 100; });
    // candidates that only show up at county level
    const known = new Set(cands.map(c => c.name));
    for (const reg of Object.values(j.region_results || {}))
      for (const c of (reg && reg.candidates) || []) if (!known.has(c.name)) { known.add(c.name); cands.push({ name: c.name, party: partyCode(c.party) }); }
    return {
      race_id: raceKey, candidates: cands, counties,
      pulled_at: new Date().toISOString(), source_updated: j.last_updated || null,
      percent_reporting: j.percent_reporting, test_data: !!j.test_data
    };
  }

  return { API, partyCode, raceKeyFor, buildIndex, toRace };
});
