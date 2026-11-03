/* County Targets engine — shared by the browser page and the GitHub blurb job (Node).
   All verdict logic lives here so the map and the AI blurbs never disagree. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CTEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const sig = x => 1 / (1 + Math.exp(-x));

  // Solve the uniform log-odds swing that puts the geography at `target` two-party Dem share.
  function solveSwing(counties, target, tf) {
    let lo = -5, hi = 5;
    for (let i = 0; i < 70; i++) {
      const m = (lo + hi) / 2;
      let num = 0, den = 0;
      for (const c of counties) { const w = c.w * (tf[c.fips] || 1); num += w * sig(c.b + m); den += w; }
      if (num / den < target) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  // Pull a race's county rows out of the scraper file into {fips: {D,R,O,ind,total,pr,pt,early,ed}}
  function liveByCounty(race) {
    const out = {};
    if (!race) return out;
    const party = {};
    for (const c of race.candidates || []) party[c.name] = (c.party || 'OTH').toUpperCase();
    const dName = (race.candidates || []).find(c => (c.party || '').toUpperCase() === 'DEM');
    const rName = (race.candidates || []).find(c => (c.party || '').toUpperCase() === 'REP');
    const indTop = (race.candidates || []).filter(c => !['DEM', 'REP'].includes((c.party || '').toUpperCase()));
    for (const row of race.counties || []) {
      let D = 0, R = 0, O = 0; const ind = {};
      for (const [name, v] of Object.entries(row.votes || {})) {
        const p = party[name] || 'OTH'; const n = +v || 0;
        if (p === 'DEM') D += n; else if (p === 'REP') R += n; else { O += n; ind[name] = n; }
      }
      let early = null, ed = null;
      if (row.by_mode) {
        const sum = (o, pty) => Object.entries(o || {}).reduce((s, [nm, v]) => s + ((party[nm] || 'OTH') === pty ? +v || 0 : 0), 0);
        const ev = ['early', 'mail', 'absentee', 'advance'].map(k => row.by_mode[k]).filter(Boolean);
        early = { D: ev.reduce((s, o) => s + sum(o, 'DEM'), 0), R: ev.reduce((s, o) => s + sum(o, 'REP'), 0) };
        const e = row.by_mode.election_day;
        ed = e ? { D: sum(e, 'DEM'), R: sum(e, 'REP') } : null;
      }
      out[String(row.fips).padStart(5, '0')] = {
        D, R, O, ind, total: row.total_votes != null ? +row.total_votes : D + R + O,
        pr: row.precincts_reporting, pt: row.precincts_total, pctBasis: !!row.pct_basis, early, ed, name: row.name
      };
    }
    return { rows: out, dem: dName ? dName.name : 'Democrat', rep: rName ? rName.name : 'Republican', others: indTop.map(c => c.name) };
  }

  const fmtPct = x => (x * 100).toFixed(1) + '%';
  const fmtPts = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1);
  const fmtN = n => Math.round(n).toLocaleString('en-US');
  const fmtMargin = (d, r) => { const m = d - r; return (m >= 0 ? 'D+' : 'R+') + fmtN(Math.abs(m)); };

  // Main computation. geo = model.geos[id]; race = scraper race object (or null); opts.target = two-party target share
  function compute(geo, race, opts) {
    opts = opts || {};
    const target = opts.target || 0.5;
    const live = liveByCounty(race);
    const L = live.rows || {};

    // Turnout factor: learn from counties that are fully reported (all precincts in).
    let compV = 0, compW = 0, nComp = 0;
    for (const c of geo.counties) {
      const l = L[c.fips];
      if (l && l.pt && l.pr >= l.pt && (l.D + l.R) > 0) { compV += l.D + l.R; compW += c.w; nComp++; }
    }
    const totW = geo.counties.reduce((s, c) => s + c.w, 0);
    let turnout = 1, turnoutLearned = false;
    if (opts.turnout) turnout = opts.turnout;
    else if (nComp >= 3 && compW / totW >= 0.08) { turnout = Math.min(1.7, Math.max(0.55, compV / compW)); turnoutLearned = true; }

    const s = solveSwing(geo.counties, target, {});
    const rows = [];
    let sumV = 0, sumE = 0, devNum = 0, devDen = 0;
    for (const c of geo.counties) {
      const t = sig(c.b + s);
      const E = c.w * turnout;
      const l = L[c.fips];
      const r = { fips: c.fips, name: c.name, t, E, split: !!c.split, hist: c.hist, hwm: c.hwm, hwm16: c.hwm16, county_hist: c.county_hist };
      if (l && (l.D + l.R) > 0) {
        const V = l.D + l.R;
        const complete = !!(l.pt && l.pr >= l.pt);
        let f = complete ? 1 : Math.min(0.99, V / E);
        let Eeff = E;
        if (l.pt && !complete && l.pr != null) {
          const p = Math.min(0.99, l.pr / l.pt);
          if (l.pctBasis) {
            // reported % of expected vote: trust it, and use it to re-estimate this county's total
            f = Math.min(0.99, 0.75 * p + 0.25 * f);
            if (p > 0.05) { const wt = Math.min(1, p * 1.5); Eeff = wt * (V / p) + (1 - wt) * E; }
          } else f = Math.max(Math.min(f, 0.99), p * 0.6 + f * 0.4);
        }
        if (complete) Eeff = V;
        r.E = Math.max(Eeff, V);
        const A = l.D / V;
        const earlyOnly = !!(l.early && (l.early.D + l.early.R) > 0 && (!l.ed || (l.ed.D + l.ed.R) < 0.05 * V) && !complete);
        const dev = A - t;
        // tolerance widens when little is counted, more when only early/mail votes are in
        const band = 0.012 + 0.07 * (1 - f) + (earlyOnly ? 0.03 : 0) + (c.split ? 0.01 : 0);
        let verdict = 'neutral';
        if (f < 0.03) verdict = 'early';
        else if (dev > band) verdict = 'good';
        else if (dev < -band) verdict = 'bad';
        const strength = Math.min(1, Math.abs(dev) / 0.08);
        const paceNet = 2 * V * dev; // net votes vs. win pace at the current count
        Object.assign(r, { live: l, V, A, f, complete, earlyOnly, dev, band, verdict, strength, paceNet,
          margin: l.D - l.R, targetMarginNow: (2 * t - 1) * V });
        sumV += V; sumE += r.E;
        if (!earlyOnly) { devNum += dev * V; devDen += V; }
      } else {
        Object.assign(r, { live: l || null, V: 0, f: 0, verdict: 'waiting' });
        sumE += E;
      }
      rows.push(r);
    }

    // Projection of the final result
    const avgDev = devDen > 0 ? devNum / devDen : 0;
    const counted = sumE > 0 ? sumV / sumE : 0;
    let pD = 0, pR = 0;
    for (const r of rows) {
      const rem = r.complete ? 0 : Math.max(0, r.E - (r.V || 0));
      let share;
      if (r.V > 0) {
        const k = r.earlyOnly ? 0.3 : 0.5 + 0.4 * r.f;
        share = r.t + r.dev * k;
      } else share = r.t + avgDev * 0.6 * Math.min(1, devDen / Math.max(1, sumE) * 4);
      share = Math.min(0.97, Math.max(0.03, share));
      pD += (r.live ? r.live.D : 0) + rem * share;
      pR += (r.live ? r.live.R : 0) + rem * (1 - share);
    }
    const projShare = pD / (pD + pR);
    const unc = 0.006 + 0.06 * (1 - counted);
    let outlook = 'waiting';
    if (sumV > 0) outlook = projShare - 0.5 > unc ? 'good' : projShare - 0.5 < -unc ? 'bad' : 'neutral';

    const curD = rows.reduce((s, r) => s + (r.live ? r.live.D : 0), 0);
    const curR = rows.reduce((s, r) => s + (r.live ? r.live.R : 0), 0);
    const curO = rows.reduce((s, r) => s + (r.live ? r.live.O : 0), 0);
    const indTotals = {};
    for (const r of rows) if (r.live) for (const [k, v] of Object.entries(r.live.ind || {})) indTotals[k] = (indTotals[k] || 0) + v;

    const reporting = rows.filter(r => r.V > 0);
    const drivers = reporting.slice().sort((a, b) => b.paceNet - a.paceNet);
    return {
      geo: geo.id, target, swing: s, turnout, turnoutLearned, rows,
      dem: live.dem, rep: live.rep, others: live.others,
      counted, projShare, projMargin: 2 * projShare - 1, unc, outlook, avgDev,
      cur: { D: curD, R: curR, O: curO, ind: indTotals },
      nReporting: reporting.length, nCounties: rows.length,
      helping: drivers.filter(r => r.paceNet > 0).slice(0, 5),
      hurting: drivers.filter(r => r.paceNet < 0).reverse().slice(0, 5),
      tally: { good: rows.filter(r => r.verdict === 'good').length, bad: rows.filter(r => r.verdict === 'bad').length,
               neutral: rows.filter(r => r.verdict === 'neutral').length }
    };
  }

  // Pick the comparison points the page and blurbs use: 2024, 2022, high-water mark
  function comparisons(row, geo, raceKey) {
    const H = row.hist || [];
    const pick = (yr, prefs) => { for (const p of prefs) { const h = H.find(x => x.k === `${yr}-${p}`); if (h) return h; } return null; };
    const same = raceKey === 'HOUSE' ? ['HOUSE'] : raceKey === 'GOV' ? ['GOV'] : ['SEN', 'SEN_SPEC'];
    const c24 = pick(2024, ['PRES']);
    const c24b = pick(2024, same);
    const c22 = pick(2022, same.concat(['SEN', 'GOV', 'HOUSE']));
    const sh = h => h ? h.d / (h.d + h.r) : null;
    return { y2024: c24 && { ...c24, share: sh(c24) }, y2024same: c24b && { ...c24b, share: sh(c24b) },
             y2022: c22 && { ...c22, share: sh(c22) }, hwm: row.hwm, hwm16: row.hwm16 };
  }

  // Deterministic fallback sentence (used when no Claude blurb is available or it's stale)
  function templateBlurb(row, res, raceKey) {
    if (!row.V) return `No votes yet. Win pace: ${fmtPct(row.t)} Dem (two-party).`;
    const cmp = comparisons(row, null, raceKey);
    const who = res.dem.split(' ').slice(-1)[0];
    const pace = `${fmtPts(row.dev)} pts vs. win pace (${row.paceNet >= 0 ? '+' : '−'}${fmtN(Math.abs(row.paceNet))} net votes)`;
    const vs = [];
    if (cmp.y2024) vs.push(`${fmtPts(row.A - cmp.y2024.share)} vs. ${cmp.y2024.label.replace(/^2024 /, '2024 ')}`);
    if (cmp.y2022) vs.push(`${fmtPts(row.A - cmp.y2022.share)} vs. ${cmp.y2022.label}`);
    const lead = { good: 'Ahead of win pace.', bad: 'Behind win pace.', neutral: 'Roughly on win pace.', early: 'Too few votes to read.' }[row.verdict];
    const caveat = row.earlyOnly ? ' Early/mail votes only so far; expect the Dem share to drop as Election Day votes come in.' :
      row.f < 0.35 ? ' Small share of the vote in.' : '';
    return `${lead} ${who} ${fmtPct(row.A)} with ~${Math.round(row.f * 100)}% in, ${pace}. ${vs.join('; ')}.${caveat}`;
  }

  function signature(row) { return row.live ? `${row.live.D}|${row.live.R}|${row.live.O}` : '0'; }

  return { compute, comparisons, templateBlurb, signature, liveByCounty, solveSwing, sig, fmtPct, fmtPts, fmtN, fmtMargin };
});
