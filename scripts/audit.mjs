// civicAPI audit: accuracy and speed vs. official state results (Georgia SOS, North Carolina SBE).
// One run = one poll ("tick"). The audit workflow runs it every ~60 s and commits data/audit/report.json every few ticks.
// State (every distinct count each source has shown, with the time we first saw it) lives in AUDIT_STATE between ticks.
//
// Speed: for each count civicAPI shows, find when the state site first showed the identical count (D and R votes)
//        -> lag = civic first-seen time - state first-seen time. Resolution ~ the poll interval.
// Accuracy: (a) counties both sources call fully reported must match exactly; (b) whenever totals are equal, the D/R split must be too.
import fs from 'fs';
import path from 'path';
const CODE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = process.env.CT_ROOT || CODE;
const STATE = process.env.AUDIT_STATE || '/tmp/audit/state.json';
const REPORT = path.join(ROOT, 'data/audit/report.json');
const now = process.env.CT_NOW ? Date.parse(process.env.CT_NOW) : Date.now();
const UA = { 'User-Agent': 'SAM-election-audit/1.0 (results accuracy check; low frequency)' };

const GA_BASE = 'https://results.sos.ga.gov/results/public/api/elections';
const GA_EL = '11032026GeneralAndSpecialElection';
const NC_BASE = 'https://er.ncsbe.gov/enr/20261103/data';
const CIVIC = 'https://civicapi.org/api/v2/race/';
const RACES = [
  { key: 'GA-SEN', label: 'Georgia Senate', state: 'GA', civic: 87087, ref: 'US Senate' },
  { key: 'GA-GOV', label: 'Georgia Governor', state: 'GA', civic: 87088, ref: 'Governor' },
  { key: 'NC-SEN', label: 'North Carolina Senate', state: 'NC', civic: 87346, ref: 'US SENATE (VOTE FOR 1)' },
  { key: 'NC-05', label: 'NC-05', state: 'NC', civic: 87336, ref: 'US HOUSE OF REPRESENTATIVES DISTRICT 05 (VOTE FOR 1)' },
  { key: 'NC-11', label: 'NC-11', state: 'NC', civic: 87342, ref: 'US HOUSE OF REPRESENTATIVES DISTRICT 11 (VOTE FOR 1)' },
];
const GA_PER_TICK = +(process.env.GA_PER_TICK || 15), NC_PER_TICK = +(process.env.NC_PER_TICK || 40);

const S = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : { hist: {}, civicUpd: {}, cursor: { GA: 0, NC: 1 }, errors: [], ticks: 0, refStatus: {} };
const MODEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/model/model.json')));
const norm = s => String(s || '').toLowerCase().replace(/ county$/, '').replace(/[^a-z]/g, '');
const fipsByName = {};
for (const st of ['GA', 'NC']) { fipsByName[st] = {}; for (const c of MODEL.geos[st].counties) fipsByName[st][norm(c.name)] = c.fips; }

async function get(url, json = true, ms = 25000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { headers: UA, signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const txt = await r.text(); return json ? JSON.parse(txt.replace(/\r/g, '')) : txt; }
  finally { clearTimeout(t); }
}
// record a count if it changed; keep the time we first saw it
function rec(race, src, unit, o) {
  const H = ((S.hist[race] = S.hist[race] || {})[src] = S.hist[race][src] || {});
  const arr = (H[unit] = H[unit] || []);
  const last = arr[arr.length - 1];
  if (!last || last.D !== o.D || last.R !== o.R || last.T !== o.T) arr.push({ t: now, D: o.D, R: o.R, T: o.T, pr: o.pr, done: !!o.done });
  else { last.pr = o.pr; last.done = !!o.done; last.seen = now; }
}
const err = (where, e) => { S.errors.push({ t: now, where, e: String(e.message || e).slice(0, 160) }); S.errors = S.errors.slice(-60); };

// ---------- civicAPI ----------
async function pollCivic() {
  await Promise.all(RACES.map(async R => {
    try {
      const j = await get(CIVIC + R.civic);
      const party = p => String(p || '').toLowerCase().startsWith('dem') ? 'D' : String(p || '').toLowerCase().startsWith('rep') ? 'R' : 'O';
      const tot = cs => { let D = 0, Rr = 0, T = 0; for (const c of cs || []) { const v = +c.votes || 0; T += v; const p = party(c.party); if (p === 'D') D += v; else if (p === 'R') Rr += v; } return { D, R: Rr, T }; };
      let pr = +j.percent_reporting || 0; if (pr > 0 && pr <= 1) pr *= 100;
      rec(R.key, 'civic', 'state', { ...tot(j.candidates), pr, done: pr >= 100 });
      for (const reg of Object.values(j.region_results || {})) {
        if (!reg || !reg.fips) continue;
        let p = +reg.percent_reporting || 0; if (p > 0 && p <= 1) p *= 100;
        rec(R.key, 'civic', String(reg.fips).padStart(5, '0'), { ...tot(reg.candidates), pr: p, done: p >= 100 });
      }
      const u = (S.civicUpd[R.key] = S.civicUpd[R.key] || []);
      if (j.last_updated && (!u.length || u[u.length - 1].lu !== j.last_updated)) u.push({ t: now, lu: j.last_updated });
    } catch (e) { err('civic ' + R.key, e); }
  }));
}

// ---------- Georgia SOS (Enhanced Voting) ----------
const gaName = b => (b.name || []).map(n => n.text).join('');
function gaTot(item) {
  let D = 0, R = 0, T = 0;
  for (const o of (item.summaryResults || {}).ballotOptions || []) {
    const v = +o.voteCount || 0; T += v;
    const ab = String((o.party && o.party.abbreviation) || '').toLowerCase();
    if (ab.startsWith('dem')) D += v; else if (ab.startsWith('rep')) R += v;
  }
  const rs = item.reportingStatus || {};
  const pr = rs.totalUnits ? 100 * (rs.reportingUnits || 0) / rs.totalUnits : 0;
  return { D, R, T, pr, done: rs.totalUnits > 0 && rs.reportingUnits >= rs.totalUnits };
}
async function pollGA() {
  let st;
  try { st = await get(`${GA_BASE}/Georgia/${GA_EL}/data`); } catch (e) { err('GA state', e); return; }
  for (const R of RACES.filter(r => r.state === 'GA')) { const it = (st.ballotItems || []).find(b => gaName(b) === R.ref); if (it) rec(R.key, 'ref', 'state', gaTot(it)); }
  const locs = ((st.jurisdiction || {}).childLocalities || []).map(c => ({ short: c.shortName, name: (c.name || []).map(n => n.text).join(''), sig: `${c.percentReporting}|${c.precinctsReporting}|${c.turnoutPercent}` }));
  S.refStatus.GA = { at: now, counties: locs.length };
  // fetch the counties whose reporting status just changed (each county file is ~300 KB), plus one in rotation as a backstop
  S.gaSig = S.gaSig || {};
  const changed = locs.filter(L => S.gaSig[L.short] !== L.sig);
  const pick = changed.slice(0, GA_PER_TICK);
  if (locs.length) pick.push(locs[(S.cursor.GA++) % locs.length]);
  for (const L of pick) {
    const fips = fipsByName.GA[norm(L.name)]; if (!fips) continue;
    try {
      const c = await get(`${GA_BASE}/${L.short}/${GA_EL}/data`);
      for (const R of RACES.filter(r => r.state === 'GA')) { const it = (c.ballotItems || []).find(b => gaName(b) === R.ref); if (it) rec(R.key, 'ref', fips, gaTot(it)); }
      S.gaSig[L.short] = L.sig;
    } catch (e) { err('GA ' + L.short, e); }
  }
}

// ---------- North Carolina SBE ----------
function ncTot(rows, contest) {
  let D = 0, R = 0, T = 0, prt = 0, ptl = 0;
  for (const x of rows) if (x.cnm === contest) { const v = +x.vct || 0; T += v; if (x.pty === 'DEM') D += v; else if (x.pty === 'REP') R += v; prt = +x.prt || 0; ptl = +x.ptl || 0; }
  return { D, R, T, pr: ptl ? 100 * prt / ptl : 0, done: ptl > 0 && prt >= ptl, present: ptl > 0 || T > 0 };
}
async function pollNC() {
  try {
    const rows = await get(`${NC_BASE}/results_0.txt`);
    for (const R of RACES.filter(r => r.state === 'NC')) { const t = ncTot(rows, R.ref); if (t.present) rec(R.key, 'ref', 'state', t); }
  } catch (e) { err('NC state', e); return; }
  let counties = [];
  try { counties = (await get(`${NC_BASE}/county.txt`)).filter(c => c.cid !== '0'); S.refStatus.NC = { at: now, counties: counties.length }; } catch (e) { err('NC counties', e); return; }
  // county.txt carries each county's last import time: fetch the counties that just changed, plus a couple in rotation
  S.ncImp = S.ncImp || {};
  const changed = counties.filter(c => S.ncImp[c.cid] !== `${c.imp}|${c.prt}`);
  const pick = changed.slice(0, NC_PER_TICK);
  for (let i = 0; i < 2 && counties.length; i++) pick.push(counties[(S.cursor.NC++) % counties.length]);
  for (const c of pick) {
    const fips = fipsByName.NC[norm(c.cnm)]; if (!fips) continue;
    try {
      const rows = await get(`${NC_BASE}/results_${c.cid}.txt`);
      for (const R of RACES.filter(r => r.state === 'NC')) { const t = ncTot(rows, R.ref); if (t.present) rec(R.key, 'ref', fips, t); }
      S.ncImp[c.cid] = `${c.imp}|${c.prt}`;
    } catch (e) { err('NC ' + c.cnm, e); }
  }
}

// ---------- analysis ----------
const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
function lagsFor(civ, ref) {
  const out = [];
  for (const c of civ || []) {
    if (!c.T) continue;
    const exact = (ref || []).find(r => r.D === c.D && r.R === c.R && r.T === c.T);
    if (exact) { out.push({ t: c.t, lag: (c.t - exact.t) / 1000, exact: true, T: c.T }); continue; }
    const ahead = (ref || []).find(r => r.T >= c.T);
    if (ahead) out.push({ t: c.t, lag: (c.t - ahead.t) / 1000, exact: false, T: c.T });
  }
  return out;
}
function report() {
  const races = [];
  for (const R of RACES) {
    const H = S.hist[R.key] || {}, C = H.civic || {}, F = H.ref || {};
    const cNow = (C.state || []).slice(-1)[0] || null, rNow = (F.state || []).slice(-1)[0] || null;
    const stLags = lagsFor(C.state, F.state);
    const cLags = [];
    const checks = { complete: 0, exact: 0, mismatches: [], splitMismatches: [] };
    for (const unit of Object.keys(C)) {
      if (unit === 'state' || !F[unit]) continue;
      cLags.push(...lagsFor(C[unit], F[unit]).filter(x => x.exact));     // county lag: identical counts only
      // same total but a different D/R split = votes on the wrong candidate
      const cname = (MODEL.geos[R.state].counties.find(x => x.fips === unit) || {}).name || unit;
      let lastSplit = null, nSplit = 0;
      for (const c of C[unit]) { const r = F[unit].find(x => x.T === c.T && c.T > 0); if (r && (r.D !== c.D || r.R !== c.R)) { nSplit++; lastSplit = { fips: unit, name: cname, T: c.T, civic: [c.D, c.R], state: [r.D, r.R] }; } }
      if (lastSplit) checks.splitMismatches.push({ ...lastSplit, times: nSplit });     // one line per county (latest instance)
      // both sides fully reported, and the state count hasn't changed since civicAPI's latest reading
      const c = C[unit][C[unit].length - 1], r = F[unit][F[unit].length - 1];
      if (c.done && r.done && c.T > 0 && r.t <= (c.seen || c.t)) {
        checks.complete++;
        if (c.D === r.D && c.R === r.R && c.T === r.T) checks.exact++;
        else checks.mismatches.push({ fips: unit, name: (MODEL.geos[R.state].counties.find(x => x.fips === unit) || {}).name || unit, civic: { D: c.D, R: c.R, T: c.T }, state: { D: r.D, R: r.R, T: r.T } });
      }
    }
    const lagStat = a => { const v = a.map(x => x.lag); return { n: v.length, exact: a.filter(x => x.exact).length, median: q(v, 0.5), p90: q(v, 0.9), max: v.length ? Math.max(...v) : null }; };
    const firstC = (C.state || []).find(x => x.T > 0), firstR = (F.state || []).find(x => x.T > 0);
    const upd = S.civicUpd[R.key] || [];
    const gaps = upd.slice(1).map((u, i) => (Date.parse(u.lu) - Date.parse(upd[i].lu)) / 1000).filter(x => x > 0);
    races.push({
      key: R.key, label: R.label, state: R.state,
      now: { civic: cNow, state: rNow },
      firstVotes: { civic: firstC ? firstC.t : null, state: firstR ? firstR.t : null, lag: firstC && firstR ? (firstC.t - firstR.t) / 1000 : null },
      lag: { statewide: lagStat(stLags), county: lagStat(cLags), series: stLags.slice(-120) },
      accuracy: { completeCounties: checks.complete, exact: checks.exact, mismatches: checks.mismatches.slice(0, 40), splitMismatches: checks.splitMismatches.slice(0, 40), countiesCompared: Object.keys(C).filter(u => u !== 'state' && F[u]).length },
      civicRefresh: { updates: upd.length, medianGapSec: q(gaps, 0.5), last: upd.length ? upd[upd.length - 1].lu : null }
    });
  }
  return { generated_at: new Date(now).toISOString(), ticks: S.ticks, sources: { GA: 'Georgia Secretary of State (results.sos.ga.gov)', NC: 'NC State Board of Elections (er.ncsbe.gov)' }, refStatus: S.refStatus, errors: S.errors.slice(-10), races };
}

(async () => {
  await Promise.all([pollCivic(), pollGA(), pollNC()]);
  S.ticks++;
  fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(S));
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const rep = report(); fs.writeFileSync(REPORT, JSON.stringify(rep));
  const brief = rep.races.map(r => `${r.key}: civic T=${r.now.civic ? r.now.civic.T : '-'} state T=${r.now.state ? r.now.state.T : '-'} | lag med ${r.lag.statewide.median ?? '-'}s (n=${r.lag.statewide.n}) | counties compared ${r.accuracy.countiesCompared}, complete ${r.accuracy.completeCounties}, exact ${r.accuracy.exact}`).join('\n');
  console.log(`audit tick ${S.ticks}\n${brief}${S.errors.length ? '\nlast error: ' + JSON.stringify(S.errors[S.errors.length - 1]) : ''}`);
})();
