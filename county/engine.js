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

  // ---- v2 settings (shadow mode; not fitted yet) ----
  const V2 = { PRIOR_WEIGHT: 0.05, STRATUM_POOL: 0.05, EARLY_RELIAB: 0.35, COUNTY_SD: 0.08, STRATUM_SD: 0.3 };
  // Poll close (UTC) for the "first 45 minutes are early votes" rule; states that count early/mail first.
  const CLOSE_UTC = { GA: '2026-11-04T00:00:00Z', NC: '2026-11-04T00:30:00Z', OH: '2026-11-04T00:30:00Z', TX: '2026-11-04T01:00:00Z' };
  const lgt = p => { p = Math.min(0.995, Math.max(0.005, p)); return Math.log(p / (1 - p)); };

  function solveW(rows, target, wKey, bKey) {
    let lo = -5, hi = 5;
    for (let i = 0; i < 70; i++) {
      const m = (lo + hi) / 2; let n = 0, d = 0;
      for (const c of rows) { n += c[wKey] * sig(c[bKey] + m); d += c[wKey]; }
      if (n / d < target) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  // Main computation. geo = model.geos[id]; race = scraper race object (or null)
  // opts: target (two-party share, default 0.5), raceKey (SEN/GOV/HOUSE), now (ms, default Date.now())
  function compute(geo, race, opts) {
    opts = opts || {};
    const target = opts.target || 0.5;
    const now = opts.now != null ? opts.now : Date.now();
    const live = liveByCounty(race);
    const L = live.rows || {};
    const closeAt = CLOSE_UTC[geo.state] ? Date.parse(CLOSE_UTC[geo.state]) : null;
    const earlyWindow = closeAt != null && now >= closeAt && now < closeAt + 45 * 60 * 1000;

    // Turnout factor (v1): learn from counties that are fully reported.
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
    // optional alternate benchmark (Ohio Senate: Brown 2024 shape)
    const useAlt = geo.alt_label && geo.alt_label[opts.raceKey] && geo.counties.every(c => c.b_alt != null);
    const sAlt = useAlt ? solveW(geo.counties, target, 'w', 'b_alt') : null;

    const rows = [];
    let sumV = 0, sumE = 0, devNum = 0, devDen = 0;
    for (const c of geo.counties) {
      const t = sig(c.b + s);
      const E = c.w * turnout;
      const l = L[c.fips];
      const r = { fips: c.fips, name: c.name, t, b: c.b, w: c.w, E, split: !!c.split, hist: c.hist, hwm: c.hwm, hwm16: c.hwm16,
                  county_hist: c.county_hist, stratum: c.stratum || 'all', earlyDelta: c.early_delta, edayDelta: c.eday_delta };
      if (useAlt) r.tAlt = sig(c.b_alt + sAlt);
      if (l && (l.D + l.R) > 0) {
        const V = l.D + l.R;
        const complete = !!(l.pt && l.pr >= l.pt);
        let f = complete ? 1 : Math.min(0.99, V / E);
        let Eeff = E, p = null;
        if (l.pt && !complete && l.pr != null) {
          p = Math.min(0.99, l.pr / l.pt);
          if (l.pctBasis) {
            f = Math.min(0.99, 0.75 * p + 0.25 * f);
            if (p > 0.05) {
              // implied total from % reporting, kept within 0.6x-1.8x of the expected vote
              const Eimp = Math.min(Math.max(V / p, 0.6 * E), 1.8 * E);
              const k = Math.min(1, 1.5 * p);
              Eeff = k * Eimp + (1 - k) * E;
            }
          } else f = Math.max(Math.min(f, 0.99), p * 0.6 + f * 0.4);
        }
        if (complete) Eeff = V;
        r.E = Math.max(Eeff, V);
        const A = l.D / V;
        const modeEarly = !!(l.early && (l.early.D + l.early.R) > 0 && (!l.ed || (l.ed.D + l.ed.R) < 0.05 * V));
        // "likely early vote only": vote-type data says so, or votes with ~0% reporting, or the first 45 min after close in GA/NC/OH/TX
        const likelyEarly = !complete && (modeEarly || (p != null && p < 0.01) || earlyWindow);
        const earlyOnly = likelyEarly;
        // early-only counties are judged against the pace for early votes when the 2022 skew is known
        const tE = likelyEarly && r.earlyDelta != null ? sig(c.b + s + r.earlyDelta) : t;
        const dev = A - t;
        const devCmp = A - tE;
        const band = 0.012 + 0.07 * (1 - f) + (likelyEarly ? 0.03 : 0) + (c.split ? 0.01 : 0);
        let verdict = 'neutral';
        if (f < 0.03) verdict = 'early';
        else if (devCmp > band) verdict = 'good';
        else if (devCmp < -band) verdict = 'bad';
        const strength = Math.min(1, Math.abs(devCmp) / 0.08);
        const paceNet = 2 * V * dev; // net votes vs. win pace at the current count
        Object.assign(r, { live: l, V, A, f, p, complete, earlyOnly, likelyEarly, tE, dev, devCmp, band, verdict, strength, paceNet,
          margin: l.D - l.R, targetMarginNow: (2 * t - 1) * V, swing24: null });
        const p24 = (c.county_hist || c.hist || []).find(h => h.k === '2024-PRES');
        const own24 = (c.hist || []).find(h => h.k === '2024-PRES');
        if (own24) r.swing24 = A - own24.d / (own24.d + own24.r);
        sumV += V; sumE += r.E;
        if (!likelyEarly) { devNum += dev * V; devDen += V; }
      } else {
        Object.assign(r, { live: l || null, V: 0, f: 0, verdict: 'waiting' });
        sumE += E;
      }
      rows.push(r);
    }

    // ---- v1 projection (default) ----
    const avgDev = devDen > 0 ? devNum / devDen : 0;
    const counted = sumE > 0 ? sumV / sumE : 0;
    let pD = 0, pR = 0;
    for (const r of rows) {
      const rem = r.complete ? 0 : Math.max(0, r.E - (r.V || 0));
      let share;
      if (r.V > 0) {
        const k = r.likelyEarly ? 0.3 : 0.5 + 0.4 * r.f;
        share = r.t + r.dev * k;
      } else share = r.t + avgDev * 0.6 * Math.min(1, devDen / Math.max(1, sumE) * 4);
      share = Math.min(0.97, Math.max(0.03, share));
      const d = (r.live ? r.live.D : 0) + rem * share, rr = (r.live ? r.live.R : 0) + rem * (1 - share);
      pD += d; pR += rr;
      // projected full-count net votes vs. pace, for emphasis
      const tot = (r.V || 0) + rem;
      r.projShare = tot > 0 ? d / (d + rr) : r.t;
      r.projNet = 2 * Math.max(r.E, r.V || 0) * (r.projShare - r.t);
      r.lowImpact = r.V > 0 && Math.abs(r.projNet) < 1000;
    }
    const projShare = pD / (pD + pR);
    const unc = 0.006 + 0.06 * (1 - counted);
    let outlook = 'waiting';
    if (sumV > 0) outlook = projShare - 0.5 > unc ? 'good' : projShare - 0.5 < -unc ? 'bad' : 'neutral';

    // ---- win pace re-solved with live turnout weights ----
    for (const r of rows) r.Ew = Math.max(r.E, r.V || 0);
    const sLive = solveW(rows, target, 'Ew', 'b');
    for (const r of rows) r.tLive = sig(r.b + sLive);

    // ---- observed shift vs. needed shift, by county type (fully counted counties only) ----
    const shiftPanel = [];
    const byK = {};
    for (const r of rows) (byK[r.stratum] = byK[r.stratum] || []).push(r);
    for (const [k, arr] of Object.entries(byK)) {
      const done = arr.filter(r => r.V > 0 && (r.complete || r.f >= 0.98));
      const Wv = done.reduce((a, r) => a + r.V, 0);
      const obs = Wv ? done.reduce((a, r) => a + r.V * (lgt(r.A) - r.b), 0) / Wv : null;
      shiftPanel.push({ stratum: k, label: (geo.strata_labels || {})[k] || k, counties: arr.length, done: done.length,
        votes: Wv, expected: arr.reduce((a, r) => a + r.Ew, 0), observedShift: obs, neededShift: s, gap: obs == null ? null : obs - s });
    }

    // ---- v2 projection (shadow): log-odds, county types, anchored to the baseline ----
    const v2 = (() => {
      const Etot = rows.reduce((a, r) => a + r.Ew, 0);
      // turnout factor by county type (fully counted counties), falling back to the statewide factor
      const tfK = {};
      for (const [k, arr] of Object.entries(byK)) {
        const done = arr.filter(r => r.complete);
        const dv = done.reduce((a, r) => a + r.V, 0), dw = done.reduce((a, r) => a + r.w, 0);
        tfK[k] = done.length >= 2 && dw > 0 ? Math.min(1.7, Math.max(0.55, dv / dw)) : turnout;
      }
      let sumOm = 0, sumOmObs = 0;
      for (const r of rows) {
        r.E2 = r.complete ? r.V : (r.V > 0 && r.p != null && r.p > 0.05 ? r.E : Math.max(r.V || 0, r.w * tfK[r.stratum]));
        if (!r.V || r.f < 0.03) { r.omega = 0; r.obs = null; continue; }
        const adj = r.likelyEarly ? (r.earlyDelta || 0) : 0;
        r.obs = lgt(r.A) - r.b - adj;
        r.omega = r.V * (r.likelyEarly ? V2.EARLY_RELIAB : 1);
        sumOm += r.omega; sumOmObs += r.omega * r.obs;
      }
      const lam = V2.PRIOR_WEIGHT * Etot;
      const sHat = (lam * 0 + sumOmObs) / (lam + sumOm);   // prior: baseline level (shift 0)
      const mu = V2.STRATUM_POOL * Etot;
      const sK = {};
      for (const [k, arr] of Object.entries(byK)) {
        const w = arr.reduce((a, r) => a + r.omega, 0);
        sK[k] = (mu * sHat + arr.reduce((a, r) => a + r.omega * (r.obs || 0), 0)) / (mu + w);
      }
      let D = 0, T = 0, varSum = 0, remTot = 0;
      const remK = {}, wK = {};
      for (const [k, arr] of Object.entries(byK)) wK[k] = arr.reduce((a, r) => a + r.omega, 0);
      for (const r of rows) {
        const rem = Math.max(0, r.E2 - (r.V || 0));
        const base = r.b + sK[r.stratum];
        let x;
        if (!r.omega) x = base;
        else {
          const resid = r.obs - sK[r.stratum];
          const rho = r.likelyEarly ? 0.3 : 0.4 + 0.5 * r.f;
          // an early-only county's remaining vote is mostly Election Day votes, which are less Democratic
          x = base + rho * resid + (r.likelyEarly ? (r.edayDelta || 0) : 0);
        }
        const sh = Math.min(0.97, Math.max(0.03, sig(x)));
        r.v2Share = ((r.V ? r.live.D : 0) + rem * sh) / Math.max(1, (r.V || 0) + rem);
        D += (r.V ? r.live.D : 0) + rem * sh; T += (r.V || 0) + rem;
        varSum += Math.pow(rem * sh * (1 - sh) * V2.COUNTY_SD, 2); remTot += rem * sh * (1 - sh);
        remK[r.stratum] = (remK[r.stratum] || 0) + rem * sh * (1 - sh);
      }
      // a county type with little counted vote could be running very differently from the rest (the uneven-path case)
      for (const k of Object.keys(remK)) { const sdK = V2.STRATUM_SD * mu / (mu + wK[k]); varSum += Math.pow(remK[k] * sdK, 2); }
      const share = D / T;
      // rough 90% interval: county noise plus uncertainty in the statewide shift, wider when much is uncounted
      const sdState = 0.02 + 0.12 * (1 - Math.min(1, sumOm / Math.max(1, Etot)));
      const sd = Math.sqrt(varSum + Math.pow(remTot * sdState, 2)) / T;
      return { share, margin: 2 * share - 1, lo: share - 1.645 * sd, hi: share + 1.645 * sd, sHat, sK, tfK };
    })();

    const curD = rows.reduce((a, r) => a + (r.live ? r.live.D : 0), 0);
    const curR = rows.reduce((a, r) => a + (r.live ? r.live.R : 0), 0);
    const curO = rows.reduce((a, r) => a + (r.live ? r.live.O : 0), 0);
    const indTotals = {};
    for (const r of rows) if (r.live) for (const [k, v] of Object.entries(r.live.ind || {})) indTotals[k] = (indTotals[k] || 0) + v;

    const reporting = rows.filter(r => r.V > 0);
    const drivers = reporting.slice().sort((a, b) => b.projNet - a.projNet);
    return {
      geo: geo.id, target, swing: s, swingLive: sLive, turnout, turnoutLearned, rows, earlyWindow,
      dem: live.dem, rep: live.rep, others: live.others,
      counted, projShare, projMargin: 2 * projShare - 1, unc, outlook, avgDev,
      v2, shiftPanel, altLabel: useAlt ? geo.alt_label[opts.raceKey] : null,
      cur: { D: curD, R: curR, O: curO, ind: indTotals },
      nReporting: reporting.length, nCounties: rows.length,
      helping: drivers.filter(r => r.projNet > 0 && !r.lowImpact).slice(0, 5),
      hurting: drivers.filter(r => r.projNet < 0 && !r.lowImpact).reverse().slice(0, 5),
      tally: { good: rows.filter(r => r.verdict === 'good' && !r.likelyEarly).length,
               goodEarly: rows.filter(r => r.verdict === 'good' && r.likelyEarly).length,
               bad: rows.filter(r => r.verdict === 'bad').length,
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
    const caveat = row.likelyEarly ? ' Likely early/mail votes only so far; expect the Dem share to drop as Election Day votes come in.' :
      row.f < 0.35 ? ' Small share of the vote in.' : '';
    return `${lead} ${who} ${fmtPct(row.A)} with ~${Math.round(row.f * 100)}% in, ${pace}. ${vs.join('; ')}.${caveat}`;
  }

  function signature(row) { return row.live ? `${row.live.D}|${row.live.R}|${row.live.O}` : '0'; }

  return { compute, comparisons, templateBlurb, signature, liveByCounty, solveSwing, sig, fmtPct, fmtPts, fmtN, fmtMargin };
});
