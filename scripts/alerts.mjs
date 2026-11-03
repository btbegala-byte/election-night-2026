// Election-night alerts: compares this cycle's civicAPI pull (/tmp/ct_raw.json, written by county_blurbs.mjs)
// with the last one and logs notable changes to data/model/alerts.json. No AI, no network: runs in a second.
// Alert kinds: first votes, lead change, big vote drop (with the county that drove it), new race call, race now very close.
import fs from 'fs';
import path from 'path';
const CODE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = process.env.CT_ROOT || CODE;
const FILE = path.join(ROOT, 'data/model/alerts.json');            // what the dashboard reads
const SFILE = path.join(ROOT, 'data/model/alerts_state.json');     // last cycle's counts (not read by the page)
const RACES = JSON.parse(fs.readFileSync(path.join(ROOT, 'races.json'))).races || [];
const RAW = JSON.parse(fs.readFileSync(process.env.CT_RAW_IN || '/tmp/ct_raw.json'));
const APF = path.join(ROOT, 'data/model/ap_calls.json');
const AP = fs.existsSync(APF) ? JSON.parse(fs.readFileSync(APF)) : { calls: {} };
const at = process.env.CT_NOW || new Date().toISOString();

// Races worth alerting on: Senate, Governor, U.S. House (SAM targets and the other TX districts), Texas legislative targets
const watched = RACES.filter(r => r.target || r.holder || r.group === 'stsen' || r.group === 'sthouse');
const P = p => { const x = String(p || '').toLowerCase(); return x.startsWith('dem') ? 'D' : x.startsWith('rep') ? 'R' : x.startsWith('lib') ? 'L' : x.startsWith('green') ? 'G' : x.startsWith('ind') ? 'I' : '?'; };
const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const last = n => String(n || '').split(' ').slice(-1)[0];
const label = r => r.target || /^(TX|IA|MI|NC|OH)-\d+$/.test(r.label || '') ? r.label : `${r.state} ${(r.label || r.name).replace(/^US /, '')}`;

const A = { last: {}, called: {}, close: {}, items: [], ...(fs.existsSync(SFILE) ? JSON.parse(fs.readFileSync(SFILE)) : {}),
  items: fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE)).items || []) : [] };
const items = [];
const push = (r, kind, text, extra) => items.push({ at, id: r.id, state: r.state, kind, race: label(r), text, ...(extra || {}) });

for (const r of watched) {
  const d = RAW[r.id]; if (!d || !Array.isArray(d.candidates)) continue;
  if (d.test_data) continue;                                  // pre-election test numbers: never alert
  const cs = d.candidates.map(c => ({ name: c.name, p: P(c.party), v: +c.votes || 0 })).sort((a, b) => b.v - a.v);
  const tot = cs.reduce((a, c) => a + c.v, 0), pr = +d.percent_reporting || 0;
  const counties = {};
  for (const reg of Object.values(d.region_results || {})) {
    if (!reg || !reg.fips) continue;
    let D = 0, R = 0, T = 0;
    for (const c of reg.candidates || []) { const v = +c.votes || 0; T += v; if (P(c.party) === 'D') D += v; else if (P(c.party) === 'R') R += v; }
    counties[reg.fips] = { n: reg.name, D, R, T };
  }
  const prev = A.last[r.id];
  const lead = tot ? cs[0] : null, second = cs[1] || { v: 0 };
  const margin = tot ? (lead.v - second.v) / tot * 100 : 0;
  const isHouse = /House|^SD-|^HD-/.test(r.name + ' ' + (r.label || '')) || r.group;
  if (tot > 0) {
    if (!prev || !prev.tot) push(r, 'first', `First votes in: ${last(lead.name)} (${lead.p}) leads by ${margin.toFixed(1)} pts with ${fmtK(tot)} counted.`);
    else {
      // lead change (only once the count means something)
      if (prev.lead && prev.lead !== lead.name && tot >= (isHouse ? 2000 : 20000))
        push(r, 'lead', `Lead change: ${last(lead.name)} (${lead.p}) moves ahead by ${fmtK(lead.v - second.v)} votes (${margin.toFixed(1)} pts), ${Math.round(pr)}% reporting.`);
      // big vote drop: which county drove it, and how that batch broke
      const dTot = tot - prev.tot;
      const big = isHouse ? Math.max(5000, 0.15 * prev.tot) : Math.max(30000, 0.1 * prev.tot);
      if (dTot >= big) {
        let best = null;
        for (const [f, c] of Object.entries(counties)) {
          const pc = (prev.counties || {})[f] || { D: 0, R: 0, T: 0 };
          const dt = c.T - pc.T; if (!best || dt > best.dt) best = { n: c.n, dt, dD: c.D - pc.D, dR: c.R - pc.R };
        }
        const bm = best && (best.dD + best.dR) > 0 ? (best.dD - best.dR) / (best.dD + best.dR) * 100 : null;
        push(r, 'drop', `+${fmtK(dTot)} votes counted${best && best.dt > 0.25 * dTot ? `, mostly ${best.n} County (+${fmtK(best.dt)}${bm != null ? `, that batch ${bm >= 0 ? 'D' : 'R'}+${Math.abs(bm).toFixed(0)}` : ''})` : ''}. ${last(lead.name)} (${lead.p}) leads by ${margin.toFixed(1)} pts, ${Math.round(pr)}% reporting.`);
      }
    }
    // very close late in the count (once per race)
    if (!A.close[r.id] && pr >= 85 && margin < 1 && !(AP.calls || {})[r.id]) {
      A.close[r.id] = at;
      push(r, 'close', `Very close: ${fmtK(lead.v - second.v)} votes separate ${last(lead.name)} and ${last(second.name || '')} (${margin.toFixed(2)} pts) with ${Math.round(pr)}% reporting.`);
    }
  }
  // new race call from a decision desk
  const call = (AP.calls || {})[r.id];
  if (call && call.winner && !call.conflict && !A.called[r.id]) {
    A.called[r.id] = at;
    const by = (call.callers || []).map(c => c.caller).slice(0, 3).join(', ') || 'AP';
    const w = cs.find(c => last(c.name).toLowerCase() === last(call.winner).toLowerCase());
    const flip = r.holder && w && (w.p === 'D' || w.p === 'R') && w.p !== r.holder;
    push(r, 'call', `Called for ${call.winner}${w ? ` (${w.p})` : ''} by ${by}.${flip ? ` ${w.p === 'D' ? 'Democratic' : 'Republican'} pickup.` : ''}`, { flip: !!flip });
  }
  A.last[r.id] = { tot, lead: lead ? lead.name : null, pr, counties: Object.fromEntries(Object.entries(counties).map(([f, c]) => [f, { D: c.D, R: c.R, T: c.T }])) };
}

A.items = (A.items || []).concat(items).slice(-400);
fs.writeFileSync(FILE, JSON.stringify({ updated_at: at, items: A.items }));
fs.writeFileSync(SFILE, JSON.stringify({ last: A.last, called: A.called, close: A.close }));
console.log(`alerts: ${items.length} new`, items.map(i => `[${i.kind}] ${i.race}: ${i.text}`).join('\n'));
