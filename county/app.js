/* County Targets page */
(() => {
  const E = CTEngine;
  const BASE = '../data/';
  const REFRESH_MS = 90 * 1000;
  const RACE_NAMES = { SEN: 'Senate', GOV: 'Governor', HOUSE: 'House' };
  const STATES = ['GA', 'IA', 'MI', 'NC', 'OH', 'TX'];
  const qs = new URLSearchParams(location.search);

  const S = {
    model: null, geo: {}, live: {}, blurbs: {}, lastPull: {},
    geoId: qs.get('geo') || 'GA', race: qs.get('race') || null, color: 'pace',
    target: 0.5, demo: qs.has('demo'), selected: null, sort: { k: 'impact', dir: -1 }, filter: '', res: null
  };
  const $ = id => document.getElementById(id);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function getJSON(url, bust) {
    const r = await fetch(url + (bust ? (url.includes('?') ? '&' : '?') + 't=' + Date.now() : ''), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  }

  // ---------- simulated returns (for testing before polls close) ----------
  function simulate(geo, raceKey) {
    const rnd = mulberry(hash(geo.id + raceKey + Math.floor(Date.now() / 120000)));
    const s = E.solveSwing(geo.counties, 0.5, {});
    const statewide = (rnd() - 0.5) * 0.06;
    const counties = geo.counties.map(c => {
      const t = E.sig(c.b + s);
      const f = rnd() < 0.15 ? 0 : Math.min(1, 0.15 + rnd() * 1.0);
      const share = Math.min(0.95, Math.max(0.05, t + statewide + (rnd() - 0.5) * 0.08));
      const V = Math.round(c.w * (0.9 + rnd() * 0.25) * f);
      const D = Math.round(V * share), R = V - D;
      const pt = 20 + Math.floor(rnd() * 80);
      return { fips: c.fips, name: c.name, votes: { 'Dem Candidate': D, 'Rep Candidate': R, 'Other Candidate': Math.round(V * 0.015) },
        total_votes: Math.round(V * 1.015), precincts_reporting: f >= 1 ? pt : Math.floor(pt * f * 0.8), precincts_total: pt };
    });
    return { race_id: geo.id.length === 2 ? `${geo.id}-${raceKey}` : geo.id, office: RACE_NAMES[raceKey],
      candidates: [{ name: 'Dem Candidate', party: 'DEM' }, { name: 'Rep Candidate', party: 'REP' }, { name: 'Other Candidate', party: 'OTH' }], counties };
  }
  function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- data ----------
  const geoModel = () => S.model.geos[S.geoId];
  const stateOf = id => S.model.geos[id].state;
  const raceKey = () => { const g = geoModel(); return g.type === 'cd' ? 'HOUSE' : (g.races.includes(S.race) ? S.race : g.races[0]); };
  const raceId = (id, rk) => (S.model.geos[id].type === 'cd' ? id : `${id}-${rk}`);

  function findRace(id, rk) { return S.live[raceId(id, rk)] || null; }
  function currentRace() {
    const rk = raceKey();
    return S.demo ? simulate(geoModel(), rk) : findRace(S.geoId, rk);
  }

  const API = qs.get('api') || CTCivic.API;
  async function pullLive() {
    if (!S.index) S.index = CTCivic.buildIndex(await getJSON('../races.json', true));
    const keys = Object.keys(S.index).filter(k => S.model.geos[k] || S.model.geos[k.slice(0, 2)]);
    // current geography first so it paints fast
    const cur = keys.filter(k => k === raceId(S.geoId, raceKey()) || k.startsWith(S.geoId + '-'));
    const queue = cur.concat(keys.filter(k => !cur.includes(k)));
    let ok = 0;
    const worker = async () => {
      while (queue.length) {
        const k = queue.shift();
        try {
          const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
          const r = await fetch(API + S.index[k] + (API.endsWith('/') ? '' : '') + (qs.get('api') ? '.json' : ''), { cache: 'no-store', signal: ctl.signal });
          clearTimeout(tm);
          if (!r.ok) throw new Error(r.status);
          S.live[k] = CTCivic.toRace(await r.json(), k); ok++;
        } catch (e) { /* keep last good copy */ }
      }
    };
    await Promise.all([1, 2, 3, 4].map(worker));
    try { S.blurbs = await getJSON(`${BASE}model/blurbs.json`, true); } catch (e) { /* none yet */ }
    S.lastPull = { at: new Date(), ok, n: keys.length };
  }

  // ---------- rendering ----------
  let svg, gMap, path, proj;
  function colorFor(r) {
    if (S.color === 'target') return divScale(r.t - 0.5, 0.25);
    if (!r.V) return css('--wait');
    if (S.color === 'result') return divScale(r.A - 0.5, 0.25);
    if (r.verdict === 'early' || r.lowImpact) return css('--mid');
    if (r.verdict === 'good' && r.likelyEarly) return css('--d1');
    if (r.verdict === 'neutral') return css('--mid');
    return divScale(r.devCmp != null ? r.devCmp : r.dev, 0.10, true);
  }
  function divScale(x, max, skipMid) {
    const a = Math.min(1, Math.abs(x) / max);
    if (!skipMid && Math.abs(x) < max * 0.04) return css('--mid');
    const steps = x > 0 ? ['--d1', '--d2', '--d3', '--d4', '--d5'] : ['--r1', '--r2', '--r3', '--r4', '--r5'];
    return css(steps[Math.min(4, Math.floor(a * 5))]);
  }

  async function drawMap() {
    const g = geoModel(); const st = g.state;
    if (!S.geo[st]) S.geo[st] = await getJSON(`${BASE}model/geo/${st}.json`);
    const fc = S.geo[st];
    const inGeo = new Set(g.counties.map(c => c.fips));
    const feats = fc.features.filter(f => inGeo.has(f.id));
    const W = 900, H = st === 'TX' ? 820 : g.type === 'cd' ? 640 : 640;
    svg = d3.select('#map').attr('viewBox', `0 0 ${W} ${H}`);
    svg.selectAll('*').remove();
    proj = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], { type: 'FeatureCollection', features: feats });
    path = d3.geoPath(proj);
    const defs = svg.append('defs');
    defs.append('pattern').attr('id', 'hatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6)
      .attr('patternTransform', 'rotate(45)').append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
      .attr('stroke', css('--ink')).attr('stroke-opacity', .35).attr('stroke-width', 1.2);
    gMap = svg.append('g');
    if (g.type === 'cd') gMap.append('g').selectAll('path').data(fc.features.filter(f => !inGeo.has(f.id))).join('path').attr('class', 'ctx').attr('d', path);
    gMap.append('g').attr('id', 'cpaths').selectAll('path').data(feats, d => d.id).join('path').attr('class', 'c').attr('d', path)
      .on('mousemove', (ev, d) => showTip(ev, d.id)).on('mouseleave', () => { $('tip').style.display = 'none'; })
      .on('click', (ev, d) => select(d.id));
    gMap.append('g').attr('id', 'hatches').selectAll('path').data(feats.filter(f => (g.counties.find(c => c.fips === f.id) || {}).split))
      .join('path').attr('d', path).attr('fill', 'url(#hatch)').attr('pointer-events', 'none');
  }

  function paint() {
    const byF = Object.fromEntries(S.res.rows.map(r => [r.fips, r]));
    d3.select('#cpaths').selectAll('path').attr('fill', d => byF[d.id] ? colorFor(byF[d.id]) : css('--wait'))
      .classed('sel', d => d.id === S.selected).filter(d => d.id === S.selected).raise();
    legend();
  }

  function legend() {
    const sw = (v, t) => `<span class="sw" style="background:${css(v)}"></span>${t}`;
    let h;
    if (S.color === 'pace') h = `${sw('--r4', '')}${sw('--r2', 'Behind win pace')} ${sw('--mid', 'On pace / too early')} ${sw('--d2', 'Ahead')}${sw('--d4', '')} ${sw('--wait', 'No votes')}`;
    else if (S.color === 'result') h = `${sw('--r4', '')}${sw('--r2', 'GOP')} ${sw('--mid', 'Even')} ${sw('--d2', 'Dem')}${sw('--d4', '')} <span class="muted">two-party share</span>`;
    else h = `${sw('--r4', '')}${sw('--r2', 'GOP')} ${sw('--mid', 'Even')} ${sw('--d2', 'Dem')}${sw('--d4', '')} <span class="muted">share each county needs for a ${E.fmtPct(S.target)} result</span>`;
    if (geoModel().type === 'cd') h += ` <span class="sw" style="background:repeating-linear-gradient(45deg,${css('--ink3')} 0 1px,transparent 1px 4px)"></span>county split by district line`;
    $('legend').innerHTML = h;
  }

  function showTip(ev, fips) {
    const r = S.res.rows.find(x => x.fips === fips); if (!r) return;
    const t = $('tip');
    t.innerHTML = `<b>${esc(r.name)}</b>${r.split ? ' (part)' : ''}<br>` + (r.V ? `${esc(lastName(S.res.dem))} ${E.fmtPct(r.A)} · ${Math.round(r.f * 100)}% in<br>Win pace ${E.fmtPct(r.t)} · ${E.fmtPts(r.dev)} pts` : `No votes yet · win pace ${E.fmtPct(r.t)}`);
    t.style.display = 'block';
    t.style.left = Math.min(innerWidth - 270, ev.clientX + 14) + 'px'; t.style.top = (ev.clientY + 14) + 'px';
  }
  const lastName = n => String(n || '').split(' ').slice(-1)[0];
  const vchip = r => r.verdict === 'good' && r.likelyEarly ? '<span class="chip neutral">▲ Ahead (early votes only)</span>' : chip(r.verdict);
  const chip = (v, label) => {
    const icon = { good: '▲', bad: '▼', neutral: '●', early: '◌', waiting: '◌' }[v] || '';
    const text = label || { good: 'Ahead of win pace', bad: 'Behind win pace', neutral: 'On pace', early: 'Too early', waiting: 'No votes yet' }[v];
    return `<span class="chip ${v}">${icon} ${text}</span>`;
  };

  function blurbKey() { return raceId(S.geoId, raceKey()); }
  function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }

  function renderOutlook() {
    const r = S.res, g = geoModel(), rk = raceKey();
    const B = (S.blurbs.entries || {})[blurbKey()] || {};
    const ol = { good: 'On path to win', bad: 'Off the win pace', neutral: 'Too close to call', waiting: 'Waiting for votes' }[r.outlook];
    const pm = r.projMargin;
    let html = `<h2>${esc(g.name)} · ${RACE_NAMES[rk]}</h2>`;
    html += `<div class="row"><div><div class="big">${r.nReporting ? (pm >= 0 ? 'D+' : 'R+') + Math.abs(pm * 100).toFixed(1) : '—'}</div><div class="kv">projected final margin</div></div>
      <div>${chip(r.outlook, ol)}</div></div>`;
    const ind = Object.entries(r.cur.ind || {}).sort((a, b) => b[1] - a[1])[0];
    const tot = r.cur.D + r.cur.R + r.cur.O;
    html += `<div class="row">
      <div class="kv">Expected vote in<b>${r.nReporting ? Math.round(r.counted * 100) + '%' : '0%'}</b></div>
      <div class="kv">${esc(lastName(r.dem))}<b>${tot ? E.fmtN(r.cur.D) + ' · ' + E.fmtPct(r.cur.D / tot) : '—'}</b></div>
      <div class="kv">${esc(lastName(r.rep))}<b>${tot ? E.fmtN(r.cur.R) + ' · ' + E.fmtPct(r.cur.R / tot) : '—'}</b></div>
      ${ind && ind[1] > 0.04 * tot ? `<div class="kv">${esc(lastName(ind[0]))}<b>${E.fmtN(ind[1])} · ${E.fmtPct(ind[1] / tot)}</b></div>` : ''}
      <div class="kv">Counties ahead / on / behind<b>${r.tally.good} / ${r.tally.neutral} / ${r.tally.bad}</b></div></div>`;
    if (B.outlook && B.outlook.text) html += `<div class="ai">${esc(B.outlook.text)}<span class="meta">Claude · ${fmtTime(B.outlook.at)}${B.outlook.counted != null ? ` · written at ${Math.round(B.outlook.counted * 100)}% in` : ''}</span></div>`;
    else if (r.nReporting) html += `<div class="ai">${esc(templateOutlook(r))}<span class="meta">Auto-summary (Claude write-up not available yet)</span></div>`;
    if (g.type === 'cd' && g.lines_note) html += `<div class="note">Lines: ${esc(g.lines_note)}</div>`;
    if (ind && ind[1] > 0.05 * tot) html += `<div class="note">${esc(lastName(ind[0]))} has ${E.fmtPct(ind[1] / tot)} of the vote. Win pace is measured as Dem vs. GOP only.</div>`;
    if (r.nReporting) {
      const li = arr => arr.map(x => `<a data-f="${x.fips}">${esc(x.name)}${x.likelyEarly ? ' (early)' : ''}<span>${x.projNet >= 0 ? '+' : '−'}${E.fmtN(Math.abs(x.projNet))}</span></a>`).join('') || '<span class="muted">—</span>';
      html += `<div class="lists"><div><h3>Beating pace most (proj. net votes)</h3>${li(r.helping)}</div><div><h3>Trailing pace most</h3>${li(r.hurting)}</div></div>`;
      const fm = x => (x >= 0 ? 'D+' : 'R+') + Math.abs(x * 100).toFixed(1);
      html += `<div class="facts" style="margin-top:8px">Alt model (v2, testing): <b>${fm(r.v2.margin)}</b> · 90% range ${fm(2 * r.v2.lo - 1)} to ${fm(2 * r.v2.hi - 1)}${r.tally.goodEarly ? ` · ${r.tally.goodEarly} more counties ahead on early votes only` : ''}</div>`;
      const sp = r.shiftPanel.filter(x => x.done > 0);
      if (sp.length) { const pt = x => (x >= 0 ? '+' : '−') + Math.abs(x * 25).toFixed(1);
        html += `<table style="margin-top:6px"><thead><tr><th>Fully counted, by type</th><th>Done</th><th>Shift</th><th>Needed</th><th>Gap</th></tr></thead><tbody>${sp.map(x => `<tr><td>${esc(x.label)}</td><td>${x.done}/${x.counties}</td><td>${pt(x.observedShift)}</td><td>${pt(x.neededShift)}</td><td>${pt(x.gap)}</td></tr>`).join('')}</tbody></table><div class="note">Points at a 50/50 county, vs. each county's baseline.</div>`; }
    }
    html += `<div class="note">Win pace = the share each county needs if the ${g.type === 'cd' ? 'district' : 'state'} lands at ${E.fmtPct(S.target)} Dem (two-party). Projection assumes uncounted votes follow each county's pace gap, discounted for early/mail-first counting. Turnout ${r.turnoutLearned ? 'estimated from fully counted counties: ' + Math.round(r.turnout * 100) + '% of 2022' : 'assumed at 2022 levels'}.</div>`;
    $('outlook').innerHTML = html;
    $('outlook').querySelectorAll('a[data-f]').forEach(a => a.onclick = () => select(a.dataset.f));
  }

  function templateOutlook(r) {
    const d = lastName(r.dem);
    const dir = r.projMargin >= 0 ? `${d} on track to win by about ${Math.abs(r.projMargin * 100).toFixed(1)} pts` : `${d} on track to fall short by about ${Math.abs(r.projMargin * 100).toFixed(1)} pts`;
    const h = r.helping[0], b = r.hurting[0];
    return `With ~${Math.round(r.counted * 100)}% of the expected vote in, ${dir}. ${r.tally.good} counties are ahead of win pace and ${r.tally.bad} behind.` +
      (h ? ` Biggest gain vs. pace: ${h.name} (+${E.fmtN(h.paceNet)}).` : '') + (b ? ` Biggest shortfall: ${b.name} (−${E.fmtN(Math.abs(b.paceNet))}).` : '');
  }

  function renderDetail() {
    const r = S.res.rows.find(x => x.fips === S.selected);
    const el = $('detail');
    if (!r) { el.innerHTML = `<h2>Pick a county</h2><div class="facts">Click any county on the map or in the table to see its result against win pace, 2024, 2022 and its Democratic high-water mark.</div>`; return; }
    const rk = raceKey(); const cmp = E.comparisons(r, geoModel(), rk);
    const B = ((S.blurbs.entries || {})[blurbKey()] || {}).counties || {};
    const cb = B[r.fips];
    const line = (lab, share, d, rr, cls) => `<tr class="${cls || ''}"><td>${lab}</td><td>${share != null ? E.fmtPct(share) : '—'}</td><td>${d != null ? E.fmtMargin(d, rr) : '—'}</td><td>${share != null && r.V && cls !== 'live' ? E.fmtPts(r.A - share) : ''}</td></tr>`;
    let html = `<h2>${esc(r.name)} County${r.split ? ' <span class="muted">(part in district)</span>' : ''}</h2><div style="margin:4px 0 8px">${vchip(r)}</div>`;
    if (r.V) {
      const tot = r.live.D + r.live.R + r.live.O;
      html += `<div class="facts">${esc(lastName(S.res.dem))} ${E.fmtN(r.live.D)} · ${esc(lastName(S.res.rep))} ${E.fmtN(r.live.R)}${r.live.O ? ' · other ' + E.fmtN(r.live.O) : ''} · ~${Math.round(r.f * 100)}% of expected vote${r.live.pt ? (r.live.pctBasis ? ` · ${Math.round(r.live.pr)}% reporting per civicAPI` : ` · ${r.live.pr}/${r.live.pt} precincts`) : ''}${r.earlyOnly ? ' · <b>early/mail only so far</b>' : ''}</div>`;
    }
    if (cb && cb.text) {
      const stale = cb.sig !== E.signature(r);
      html += `<div class="ai">${esc(cb.text)}<span class="meta">Claude · ${fmtTime(cb.at)}${stale ? ' · numbers have moved since' : ''}</span></div>`;
    }
    html += `<div class="facts">${esc(E.templateBlurb(r, S.res, rk))}</div>`;
    html += `<table><thead><tr><th></th><th>Dem 2-party</th><th>Margin</th><th>Live vs.</th></tr></thead><tbody>`;
    if (r.V) html += line('Live 2026', r.A, r.live.D, r.live.R, 'live');
    const tE = r.V || r.E;
    const extra = [];
    if (Math.abs((r.tLive || r.t) - r.t) >= 0.005) extra.push(line('Win pace, turnout-adjusted', r.tLive, null, null, 'pace'));
    if (r.likelyEarly && r.earlyDelta != null) extra.push(line('Pace for early votes (2022 skew)', r.tE, null, null, 'pace'));
    if (r.tAlt != null && S.res.altLabel) extra.push(line(esc(S.res.altLabel), r.tAlt, null, null, 'pace'));
    html += `<tr class="pace"><td>Win pace</td><td>${E.fmtPct(r.t)}</td><td>${E.fmtMargin((2 * r.t - 1) * tE > 0 ? (2 * r.t - 1) * tE : 0, (2 * r.t - 1) * tE < 0 ? -(2 * r.t - 1) * tE : 0)}</td><td>${r.V ? E.fmtPts(r.dev) : ''}</td></tr>`;
    html += extra.join('');
    if (cmp.y2024) html += line(cmp.y2024.label, cmp.y2024.share, cmp.y2024.d, cmp.y2024.r);
    if (cmp.y2024same && cmp.y2024same.k !== (cmp.y2024 || {}).k) html += line(cmp.y2024same.label, cmp.y2024same.share, cmp.y2024same.d, cmp.y2024same.r);
    if (cmp.y2022) html += line(cmp.y2022.label, cmp.y2022.share, cmp.y2022.d, cmp.y2022.r);
    if (cmp.hwm16) html += line(`Best since 2016: ${esc(cmp.hwm16.label)}${r.split ? ' (whole county)' : ''}`, cmp.hwm16.share, null, null);
    if (cmp.hwm && (!cmp.hwm16 || cmp.hwm.label !== cmp.hwm16.label)) html += line(`Best since 2006: ${esc(cmp.hwm.label)}${r.split ? ' (whole county)' : ''}`, cmp.hwm.share, null, null);
    html += `</tbody></table>`;
    html += `<div class="note">Win-pace margin is at the current count${r.V ? '' : ' (expected turnout)'}. Full-count target: ${E.fmtMargin(Math.max(0, (2 * r.t - 1) * r.E), Math.max(0, -(2 * r.t - 1) * r.E))} on ~${E.fmtN(r.E)} two-party votes.</div>`;
    const ch = (r.county_hist || r.hist || []).filter(h => h.k.endsWith('PRES') || h.k.endsWith('SEN') || h.k.endsWith('GOV'));
    if (ch.length) html += `<details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:12px">All past races${r.split ? ' (whole county)' : ''}</summary><table><tbody>${ch.map(h => `<tr><td>${esc(h.label)}</td><td>${E.fmtPct(h.d / (h.d + h.r))}</td><td>${E.fmtMargin(h.d, h.r)}</td></tr>`).join('')}</tbody></table></details>`;
    el.innerHTML = html;
  }

  const COLS = [
    ['name', 'County', r => r.name + (r.split ? '*' : '')],
    ['f', '% in', r => r.V ? Math.round(r.f * 100) + '%' : '—'],
    ['A', 'Dem', r => r.V ? E.fmtPct(r.A) : '—'],
    ['t', 'Win pace', r => E.fmtPct(r.t)],
    ['dev', 'vs. pace', r => r.V ? E.fmtPts(r.dev) : ''],
    ['impact', 'Proj. net vs. pace', r => r.V ? `<span style="${r.lowImpact ? 'opacity:.5' : ''}">${r.projNet >= 0 ? '+' : '−'}${E.fmtN(Math.abs(r.projNet))}</span>` : ''],
    ['sw24', 'Swing vs. 2024', r => r.V && r.swing24 != null ? E.fmtPts(r.swing24) : ''],
    ['v22', 'vs. 2022', r => { const c = E.comparisons(r, null, raceKey()).y2022; return r.V && c ? E.fmtPts(r.A - c.share) : ''; }],
    ['hwm16', 'Best since 2016', r => r.hwm16 ? E.fmtPct(r.hwm16.share) : ''],
    ['hwm', 'Best since 2006', r => r.hwm ? E.fmtPct(r.hwm.share) : ''],
    ['verdict', 'Read', r => vchip(r)],
  ];
  function sortVal(r, k) {
    if (k === 'impact') return r.V ? Math.abs(r.projNet) : -1;
    if (k === 'sw24') return r.V && r.swing24 != null ? r.swing24 : -9;
    if (k === 'v24') { const c = E.comparisons(r, null, raceKey()).y2024; return r.V && c ? r.A - c.share : -9; }
    if (k === 'v22') { const c = E.comparisons(r, null, raceKey()).y2022; return r.V && c ? r.A - c.share : -9; }
    if (k === 'hwm') return r.hwm ? r.hwm.share : 0;
    if (k === 'hwm16') return r.hwm16 ? r.hwm16.share : 0;
    if (k === 'name') return r.name;
    if (k === 'verdict') return { good: 3, neutral: 2, bad: 1 }[r.verdict] || 0;
    if (k === 'E') return r.E;
    const v = r[k]; return v == null ? -9 : v;
  }
  function renderTable() {
    $('tbl').querySelector('thead').innerHTML = '<tr>' + COLS.map(([k, l]) => `<th data-k="${k}">${l}${S.sort.k === k ? (S.sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('') + '</tr>';
    $('tbl').querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.k; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === 'name' ? 1 : -1) }; renderTable(); });
    let rows = S.res.rows.filter(r => !S.filter || r.name.toLowerCase().includes(S.filter));
    rows.sort((a, b) => { const x = sortVal(a, S.sort.k), y = sortVal(b, S.sort.k); return (x > y ? 1 : x < y ? -1 : 0) * S.sort.dir; });
    if (S.sort.k === 'impact') rows.sort((a, b) => (b.V > 0) - (a.V > 0) || (S.sort.dir < 0 ? (sortVal(b, 'impact') - sortVal(a, 'impact')) || b.E - a.E : 0));
    $('tbl').querySelector('tbody').innerHTML = rows.map(r => `<tr data-f="${r.fips}">${COLS.map(c => `<td>${c[2](r)}</td>`).join('')}</tr>`).join('');
    $('tbl').querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => { select(tr.dataset.f); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  function renderTabs() {
    const mk = (id, label) => {
      const pip = tabPip(id);
      return `<button class="tab" data-g="${id}" aria-pressed="${id === S.geoId}">${label}${pip ? `<span class="pip" style="background:${pip}"></span>` : ''}</button>`;
    };
    $('stateTabs').innerHTML = '<span class="lbl">Statewide</span>' + STATES.map(s => mk(s, s)).join('');
    $('cdTabs').innerHTML = '<span class="lbl">Districts</span>' + Object.keys(S.model.geos).filter(k => k.length > 2).map(k => mk(k, k.replace('-0', '-'))).join('');
    document.querySelectorAll('button.tab').forEach(b => b.onclick = () => go(b.dataset.g));
    const g = geoModel();
    $('raceWrap').style.display = g.type === 'cd' ? 'none' : '';
    $('raceSeg').innerHTML = g.races.map(rk => `<button data-v="${rk}" aria-pressed="${rk === raceKey()}">${RACE_NAMES[rk]}</button>`).join('');
    $('raceSeg').querySelectorAll('button').forEach(b => b.onclick = () => { S.race = b.dataset.v; S.selected = null; update(); renderTabs(); });
  }
  function tabPip(id) {
    if (S.demo) return null;
    const g = S.model.geos[id];
    const rk = g.type === 'cd' ? 'HOUSE' : g.races[0];
    const race = findRace(id, rk);
    if (!race || !(race.counties || []).some(c => Object.values(c.votes || {}).some(v => +v > 0))) return null;
    const res = E.compute(g, race, { target: S.target, raceKey: rk });
    return { good: css('--d3'), bad: css('--r3'), neutral: css('--ink3') }[res.outlook] || null;
  }

  function status() {
    const dot = $('dot'), txt = $('statusText');
    if (S.demo) { dot.className = 'dot demo'; txt.textContent = 'Simulated returns — not real results'; return; }
    const r = findRace(S.geoId, raceKey());
    const pulled = S.lastPull.at ? S.lastPull.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
    if (!r) { dot.className = 'dot stale'; txt.textContent = `Couldn't load this race from civicAPI · last try ${pulled}`; return; }
    const src = r.source_updated ? ` · civicAPI updated ${fmtTime(String(r.source_updated).includes('T') || String(r.source_updated).includes('Z') ? r.source_updated : String(r.source_updated).replace(' ', 'T') + 'Z')}` : '';
    dot.className = 'dot ' + (S.lastPull.ok ? 'live' : 'stale');
    txt.textContent = `${r.test_data ? 'TEST DATA · ' : ''}Checked ${pulled}${src}`;
  }

  function update() {
    S.res = E.compute(geoModel(), currentRace(), { target: S.target, raceKey: raceKey() });
    paint(); renderOutlook(); renderDetail(); renderTable(); status();
  }
  function select(f) { S.selected = f; paint(); renderDetail(); }
  async function go(id) {
    S.geoId = id; S.selected = null;
    const u = new URL(location); u.searchParams.set('geo', id); history.replaceState(null, '', u);
    renderTabs(); await drawMap(); update();
  }

  async function init() {
    S.model = await getJSON(`${BASE}model/model.json`);
    if (!S.model.geos[S.geoId]) S.geoId = 'GA';
    $('demo').checked = S.demo;
    $('demo').onchange = e => { S.demo = e.target.checked; renderTabs(); update(); };
    $('target').oninput = e => { S.target = +e.target.value / 100; $('targetV').textContent = E.fmtPct(S.target); update(); };
    $('colorSeg').querySelectorAll('button').forEach(b => b.onclick = () => { S.color = b.dataset.v; $('colorSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); paint(); });
    $('search').oninput = e => { S.filter = e.target.value.toLowerCase(); renderTable(); };
    const m = S.model.method;
    $('method').innerHTML = `<b>Method.</b> Baseline county lean: ${esc(m.baseline)}. Win pace: ${esc(m.swing)}. ${esc(m.turnout)}. "Best since 2006" and "Best since 2016" are the highest Dem two-party share the county gave any presidential, Senate or governor nominee in a general election since that year. Gaps: North Carolina Senate and governor races before 2022 (except presidential) are not included; Texas 2020 Senate and Iowa 2008 Senate are missing. Historical data: MIT Election Data + Science Lab, OpenElections, county presidential returns 2008–2024. * = county split by the district line (history shown for the part inside the 2024 district).`;
    await pullLive().catch(() => {});
    renderTabs(); await drawMap(); update();
    setInterval(async () => { await pullLive().catch(() => {}); renderTabs(); update(); }, REFRESH_MS);
  }
  init().catch(e => { $('statusText').textContent = 'Error: ' + e.message; console.error(e); });
})();
