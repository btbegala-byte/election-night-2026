/* County Targets widget: one county map per state section on the results dashboard.
   Reuses the dashboard's civicAPI data (no extra fetches) via getRaw(raceKey). Needs d3, CTEngine, CTCivic. */
(function () {
  const E = window.CTEngine, C = window.CTCivic;
  const RN = { SEN: 'Senate', GOV: 'Governor', HOUSE: 'House' };
  const W = { model: null, geo: {}, blurbs: {}, mounts: {}, opts: null, loading: null };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const last = n => String(n || '').split(' ').slice(-1)[0];
  const COL = { d: ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'], r: ['#f9d3d0', '#f0a19b', '#e34948', '#b0302f', '#7a1d1d'],
    mid: '#5d6977', wait: '#2b3642', off: '#11171d', offLine: '#222c36' };

  const CSS = `
  .ctw{background:var(--panel,#171e26);border:1px solid var(--line,#2a3542);border-radius:8px;padding:10px 12px;margin:4px 0 14px}
  .ctw-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
  .ctw-top .t{font-size:13px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted,#8a99a8)}
  .ctw select{background:var(--panel2,#1d2630);color:var(--text,#e8edf2);border:1px solid var(--line,#2a3542);border-radius:6px;padding:4px 8px;font:inherit;font-size:13px}
  .ctw .seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line,#2a3542);border-radius:6px;overflow:hidden}
  .ctw .seg button{border:0;border-radius:0;padding:4px 9px;font-size:12px;background:var(--panel2,#1d2630);color:var(--muted,#8a99a8)}
  .ctw .seg button.on{background:var(--navy,#17365D);color:var(--text,#e8edf2)}
  .ctw a.full{margin-left:auto;color:var(--blue,#4F81BD);font-size:13px;text-decoration:none}
  .ctw-body{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,1fr);gap:14px}
  @media (max-width:860px){.ctw-body{grid-template-columns:1fr}}
  .ctw svg{width:100%;height:auto;display:block;max-height:520px}
  .ctw path.c{stroke:#0f1419;stroke-width:.6;vector-effect:non-scaling-stroke;cursor:pointer}
  .ctw path.c:hover{stroke:#e8edf2;stroke-width:1.4}
  .ctw path.c.sel{stroke:#fff;stroke-width:2}
  .ctw path.off{fill:${COL.off};stroke:${COL.offLine};stroke-width:.5;vector-effect:non-scaling-stroke}
  .ctw .leg{display:flex;gap:5px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted,#8a99a8);margin-top:4px}
  .ctw .leg i{display:inline-block;width:18px;height:9px;border-radius:2px}
  .ctw .big{font-size:28px;font-weight:700;line-height:1.1}
  .ctw .kvs{display:flex;gap:16px;flex-wrap:wrap;margin:6px 0;font-size:12px;color:var(--muted,#8a99a8)}
  .ctw .kvs b{display:block;color:var(--text,#e8edf2);font-size:15px}
  .ctw .pill{display:inline-flex;gap:5px;align-items:center;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--line,#2a3542);color:var(--muted,#8a99a8);white-space:nowrap}
  .ctw .pill.good{color:#6fd36f;border-color:#2fb36d88;background:#2fb36d1a}
  .ctw .pill.bad{color:#ff8f8f;border-color:#d0464f88;background:#d0464f1a}
  .ctw .ai{margin:8px 0;padding:8px 10px;border-left:3px solid var(--blue,#4F81BD);background:#4F81BD14;border-radius:0 6px 6px 0;font-size:13.5px}
  .ctw .ai small{display:block;color:var(--muted,#8a99a8);font-size:11px;margin-top:3px}
  .ctw .note{font-size:11.5px;color:var(--muted,#8a99a8);margin-top:6px}
  .ctw .lists{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12.5px;margin-top:6px}
  .ctw .lists h4{margin:0 0 3px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted,#8a99a8);font-weight:600}
  .ctw .lists a{display:flex;justify-content:space-between;color:var(--text,#e8edf2);text-decoration:none;cursor:pointer;padding:1px 0;border-bottom:1px dotted var(--line,#2a3542)}
  .ctw .lists a span{color:var(--muted,#8a99a8);font-variant-numeric:tabular-nums}
  .ctw .det{border-top:1px solid var(--line,#2a3542);margin-top:10px;padding-top:8px}
  .ctw .det h4{margin:0 0 4px;font-size:15px}
  .ctw table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums;margin-top:6px}
  .ctw td{padding:3px 4px;border-bottom:1px solid var(--line,#2a3542);text-align:right}
  .ctw td:first-child{text-align:left;color:var(--muted,#8a99a8)}
  .ctw tr.live td{font-weight:700;color:var(--text,#e8edf2)}
  .ctw-tip{position:fixed;pointer-events:none;background:#e8edf2;color:#0f1419;font-size:12px;padding:6px 8px;border-radius:6px;z-index:50;display:none;max-width:250px;line-height:1.35}`;

  function ramp(x, max) {
    const a = Math.min(1, Math.abs(x) / max); const s = x > 0 ? COL.d : COL.r;
    return s[Math.min(4, Math.floor(a * 5))];
  }
  // % reporting: lighter = more of the count in
  const repFill = q => q == null ? COL.wait : `rgba(232,237,242,${(0.18 + 0.74 * Math.min(100, q) / 100).toFixed(3)})`;
  const TURN = { up: ['#2f6f69', '#3f9d94', '#7dd3c8'], down: ['#8a5a22', '#c07f32', '#eab26a'] };
  function turnFill(x) {           // x = turnout as a share of 2022
    if (x == null) return COL.wait;
    const d = x - 1, a = Math.abs(d); if (a < 0.03) return COL.mid;
    const arr = d > 0 ? TURN.up : TURN.down; return arr[a < 0.1 ? 0 : a < 0.25 ? 1 : 2];
  }
  function fill(r, mode) {
    if (mode === 'shift') { const sw = window.CTExtras && CTExtras.shift24(r); return sw == null ? COL.wait : '#3a4652'; }
    if (mode === 'turnout') return turnFill(r.turnout22);
    if (mode === 'rep') { const q = E.reporting(r); return q == null && !r.V ? COL.wait : repFill(q != null ? q : (r.complete ? 100 : null)); }
    if (mode === 'target') return Math.abs(r.t - 0.5) < 0.01 ? COL.mid : ramp(r.t - 0.5, 0.25);
    if (!r.V) return COL.wait;
    if (mode === 'result') return Math.abs(r.A - 0.5) < 0.01 ? COL.mid : ramp(r.A - 0.5, 0.25);
    if (r.lowImpact) return COL.mid;
    if (r.verdict === 'good' && r.likelyEarly) return COL.d[0];
    if (r.verdict === 'good' || r.verdict === 'bad') return ramp(r.devCmp != null ? r.devCmp : r.dev, 0.10);
    return COL.mid;
  }
  const vpill = r => r.verdict === 'good' && r.likelyEarly ? '<span class="pill" style="opacity:.8">▲ Ahead (early votes only)</span>' : pill(r.verdict);
  const pill = (v, txt) => `<span class="pill ${v}">${{ good: '▲', bad: '▼', neutral: '●' }[v] || '◌'} ${txt || { good: 'Ahead of win pace', bad: 'Behind win pace', neutral: 'On pace', early: 'Too early', waiting: 'No votes yet' }[v]}</span>`;
  const fmtT = iso => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };

  function options(st) {
    const out = [];
    const g = W.model.geos[st];
    for (const rk of g.races) out.push({ v: `${st}-${rk}`, geo: st, rk, label: `${RN[rk]} · statewide` });
    for (const [id, cg] of Object.entries(W.model.geos)) if (cg.type === 'cd' && cg.state === st) out.push({ v: id, geo: id, rk: 'HOUSE', label: `${id.replace('-0', '-')} · House district` });
    return out;
  }

  async function ensureModel() {
    if (W.model) return;
    if (!W.loading) W.loading = (async () => {
      const r = await fetch(W.opts.base + 'model/model.json'); W.model = await r.json();
    })();
    await W.loading;
  }
  async function ensureGeo(st) {
    if (!W.geo[st]) W.geo[st] = await (await fetch(W.opts.base + `model/geo/${st}.json`)).json();
    return W.geo[st];
  }

  async function mount(el, st) {
    await ensureModel();
    if (!document.getElementById('ctw-css')) { const s = document.createElement('style'); s.id = 'ctw-css'; s.textContent = CSS; document.head.appendChild(s); }
    if (!document.getElementById('ctw-tip')) { const t = document.createElement('div'); t.id = 'ctw-tip'; t.className = 'ctw-tip'; document.body.appendChild(t); }
    const opts = options(st);
    const m = W.mounts[st] = { el, st, sel: opts[0].v, mode: 'result', county: null, opts };
    el.innerHTML = `<div class="ctw">
      <div class="ctw-top"><span class="t">County targets</span>
        <select aria-label="Race">${opts.map(o => `<option value="${o.v}">${esc(o.label)}</option>`).join('')}</select>
        <span class="seg"><button data-m="result" class="on">Result</button><button data-m="pace">vs. win pace</button><button data-m="target">Win pace</button><button data-m="rep">% reporting</button><button data-m="shift">Shift vs. 2024</button><button data-m="turnout">Turnout vs. 2022</button></span>
        <a class="full" target="_blank" rel="noopener">Full map ↗</a></div>
      <div class="ctw-body"><div><svg></svg><div class="leg"></div></div><div class="side"><div class="ol"></div><div class="det"></div></div></div></div>`;
    el.querySelector('select').onchange = e => { m.sel = e.target.value; m.county = null; draw(m); };
    el.querySelectorAll('.seg button').forEach(b => b.onclick = () => { m.mode = b.dataset.m; el.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b)); paint(m); });
    await ensureGeo(st);
    draw(m);
  }

  function cur(m) { return m.opts.find(o => o.v === m.sel); }

  function draw(m) {
    const o = cur(m), g = W.model.geos[o.geo], fc = W.geo[m.st];
    const inGeo = new Set(g.counties.map(c => c.fips));
    const svg = d3.select(m.el).select('svg');
    const Wd = 900, H = m.st === 'TX' ? 760 : 620;
    svg.attr('viewBox', `0 0 ${Wd} ${H}`).selectAll('*').remove();
    const proj = d3.geoMercator().fitExtent([[6, 6], [Wd - 6, H - 6]], fc);   // always the whole state
    const path = d3.geoPath(proj);
    const defs = svg.append('defs');
    defs.append('pattern').attr('id', `h-${m.st}`).attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6)
      .attr('patternTransform', 'rotate(45)').append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).attr('stroke', '#e8edf2').attr('stroke-opacity', .45).attr('stroke-width', 1.2);
    const zl = svg.append('g').attr('class', 'zl');
    m.path = path; m.zl = zl; m.feats = fc.features.filter(f => inGeo.has(f.id));
    zl.append('g').selectAll('path').data(fc.features.filter(f => !inGeo.has(f.id))).join('path').attr('class', 'off').attr('d', path);
    zl.append('g').attr('class', 'cp').selectAll('path').data(fc.features.filter(f => inGeo.has(f.id)), d => d.id).join('path').attr('class', 'c').attr('d', path)
      .on('mousemove', (ev, d) => tip(ev, m, d.id)).on('mouseleave', () => { document.getElementById('ctw-tip').style.display = 'none'; })
      .on('click', (ev, d) => { m.county = d.id; paint(m); detail(m); });
    zl.append('g').attr('pointer-events', 'none').selectAll('path').data(fc.features.filter(f => (g.counties.find(c => c.fips === f.id) || {}).split))
      .join('path').attr('d', path).attr('fill', `url(#h-${m.st})`);
    const cityUpd = window.CTCities ? CTCities.draw(zl, proj, m.st, { svg: svg.node() }) : null;
    if (window.CTZoom) CTZoom.attach(svg.node(), zl.node(), { container: svg.node().parentNode, onZoom: k => cityUpd && cityUpd(k) });
    m.el.querySelector('a.full').href = `county/?geo=${o.geo}${o.rk !== 'HOUSE' ? '&race=' + o.rk : ''}`;
    paint(m);
  }

  function compute(m) {
    const o = cur(m), g = W.model.geos[o.geo];
    const raw = W.opts.getRaw(o.v);
    m.race = raw ? C.toRace(raw, o.v) : null;
    m.res = E.compute(g, m.race, { target: 0.5, raceKey: o.rk });
    m.g = g; m.o = o;
  }

  function paint(m) {
    compute(m);
    const by = Object.fromEntries(m.res.rows.map(r => [r.fips, r]));
    d3.select(m.el).select('g.cp').selectAll('path').attr('fill', d => by[d.id] ? fill(by[d.id], m.mode) : COL.wait)
      .classed('sel', d => d.id === m.county).filter(d => d.id === m.county).raise();
    const sw = (c, t) => `<i style="background:${c}"></i>${t}`;
    d3.select(m.el).selectAll('g.shift-arrows').remove();
    if (m.mode === 'shift' && window.CTExtras && m.zl) {
      const a = CTExtras.arrows(m.zl, m.path, m.feats, by, { dem: '#5b9cf0', rep: '#f0646b' });
      const cities = m.zl.select('g.cities').node(); if (cities) m.zl.node().appendChild(cities);    // keep city labels on top
    }
    let lg = m.mode === 'shift' ? `<span>Arrows show each county's shift from 2024 (Dem two-party share): <b style="color:#5b9cf0">↖ toward Dems</b> · <b style="color:#f0646b">↗ toward GOP</b>; longer = bigger shift; faded = early votes only so far</span> ${sw(COL.wait, 'No votes yet')}`
      : m.mode === 'turnout' ? `${sw(TURN.down[2], '')}${sw(TURN.down[1], '')}${sw(TURN.down[0], 'Below 2022')} ${sw(COL.mid, 'About the same')} ${sw(TURN.up[0], 'Above 2022')}${sw(TURN.up[1], '')}${sw(TURN.up[2], '')} <span>projected two-party turnout vs. 2022 · gray = too little in to tell</span>`
      : m.mode === 'rep' ? `${sw(COL.wait, 'Nothing in')} ${sw(repFill(10), '')}${sw(repFill(35), '')}${sw(repFill(65), '')}${sw(repFill(100), '')} <span>% of the count reported, 0 → 100</span>`
      : m.mode === 'pace' ? `${sw(COL.r[3], '')}${sw(COL.r[1], 'Behind win pace')} ${sw(COL.mid, 'On pace')} ${sw(COL.d[1], 'Ahead')}${sw(COL.d[3], '')} ${sw(COL.wait, 'No votes')}`
      : `${sw(COL.r[3], '')}${sw(COL.r[1], 'GOP')} ${sw(COL.mid, 'Even')} ${sw(COL.d[1], 'Dem')}${sw(COL.d[3], '')} <span>${m.mode === 'target' ? 'share each county needs for a Dem win' : 'two-party share'}</span>`;
    if (m.g.type === 'cd') lg += ` <i style="background:repeating-linear-gradient(45deg,#8a99a8 0 1px,transparent 1px 4px)"></i>split county · dark counties are outside the district`;
    m.el.querySelector('.leg').innerHTML = lg;
    outlook(m); detail(m);
  }

  function outlook(m) {
    const r = m.res, g = m.g;
    const B = ((W.blurbs.entries || {})[m.o.v]) || {};
    const tot = r.cur.D + r.cur.R + r.cur.O;
    const lab = { good: 'On path to win', bad: 'Off the win pace', neutral: 'Too close to call', waiting: 'Waiting for votes' }[r.outlook];
    const ind = Object.entries(r.cur.ind || {}).sort((a, b) => b[1] - a[1])[0];
    let h = `<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap"><div><div class="big">${r.nReporting ? (r.projMargin >= 0 ? 'D+' : 'R+') + Math.abs(r.projMargin * 100).toFixed(1) : '—'}</div>
      <div class="note" style="margin:0">projected final margin · ${esc(g.name)} ${RN[m.o.rk]}</div></div>${pill(r.outlook, lab)}</div>`;
    const RR = E.raceReporting(m.race, r);
    h += `<div class="kvs"><div>Reporting<b>${RR.pct != null ? Math.round(RR.pct) + '%' : '—'}</b><span style="font-size:11px">${RR.full} of ${RR.n} counties fully in</span></div><div>Expected vote in<b>${Math.round(r.counted * 100)}%</b><span style="font-size:11px">model estimate</span></div><div>Turnout vs. 2022<b>${r.turnoutLearned && r.turnoutVs22 ? Math.round(r.turnoutVs22 * 100) + '%' : '—'}</b><span style="font-size:11px">${r.turnoutLearned ? 'projected, two-party' : 'once 3+ counties finish'}</span></div>
      <div>${esc(last(r.dem))}<b>${tot ? E.fmtPct(r.cur.D / tot) : '—'}</b></div><div>${esc(last(r.rep))}<b>${tot ? E.fmtPct(r.cur.R / tot) : '—'}</b></div>
      ${ind && ind[1] > 0.05 * tot ? `<div>${esc(last(ind[0]))}<b>${E.fmtPct(ind[1] / tot)}</b></div>` : ''}
      <div>Ahead / on / behind<b>${r.tally.good} / ${r.tally.neutral} / ${r.tally.bad}</b>${r.tally.goodEarly ? `<span style="font-size:11px">+${r.tally.goodEarly} ahead on early votes only</span>` : ''}</div></div>`;
    if (r.nReporting) {
      const fm = x => (x >= 0 ? 'D+' : 'R+') + Math.abs(x * 100).toFixed(1);
      h += `<div class="note" style="margin-top:2px">Alt model (v2, testing): <b style="color:var(--text,#e8edf2)">${fm(r.v2.margin)}</b> · 90% range ${fm(2 * r.v2.lo - 1)} to ${fm(2 * r.v2.hi - 1)}. Projects uncounted counties from their own county type instead of pulling them toward win pace.</div>`;
      if (r.earlyWindow) h += `<div class="note">First 45 minutes after polls close: counties are treated as early/mail votes only, and "ahead" verdicts are held back.</div>`;
    }
    if (B.outlook && B.outlook.text) h += `<div class="ai">${esc(B.outlook.text)}<small>Claude · ${fmtT(B.outlook.at)}${B.outlook.counted != null ? ` · at ${Math.round(B.outlook.counted * 100)}% in` : ''}</small></div>`;
    if (r.nReporting) {
      const li = a => a.map(x => `<a data-f="${x.fips}">${esc(x.name)}${x.likelyEarly ? ' <span>(early)</span>' : ''}<span>${x.projNet >= 0 ? '+' : '−'}${E.fmtN(Math.abs(x.projNet))}</span></a>`).join('') || '<span class="note">—</span>';
      h += `<div class="lists"><div><h4>Beating win pace · proj. net votes</h4>${li(r.helping.slice(0, 4))}</div><div><h4>Trailing win pace · proj. net votes</h4>${li(r.hurting.slice(0, 4))}</div></div>`;
      if (window.CTExtras) h += CTExtras.whereLeft(r, E, { rk: m.o.rk, n: 6, link: true });
      const sp = r.shiftPanel.filter(x => x.done > 0);
      if (sp.length) {
        const pt = x => (x >= 0 ? '+' : '−') + Math.abs(x * 25).toFixed(1);
        h += `<table style="margin-top:8px"><tr><td>Fully counted counties, by type</td><td>Done</td><td>Shift</td><td>Needed</td><td>Gap</td></tr>` +
          sp.map(x => `<tr><td>${esc(x.label)}</td><td>${x.done}/${x.counties}</td><td>${pt(x.observedShift)}</td><td>${pt(x.neededShift)}</td><td>${pt(x.gap)}</td></tr>`).join('') +
          `</table><div class="note">Shift vs. each county's baseline, in points at a 50/50 county. In IA, OH and TX a win needs big counties to run well above the needed shift, so small counties falling short is expected.</div>`;
      }
    } else h += `<div class="note">No votes counted yet. Hover a county for the share it needs for a Dem win, or switch the color to "Win pace".</div>`;
    m.el.querySelector('.ol').innerHTML = h;
    m.el.querySelectorAll('.ol a[data-f]').forEach(a => a.onclick = () => { m.county = a.dataset.f; paint(m); });
  }

  function detail(m) {
    const el = m.el.querySelector('.det');
    const r = m.res.rows.find(x => x.fips === m.county);
    if (!r) { el.innerHTML = `<div class="note">Click a county for its result against win pace, 2024, 2022 and its best Dem showing.</div>`; return; }
    const cmp = E.comparisons(r, null, m.o.rk);
    const cb = ((((W.blurbs.entries || {})[m.o.v]) || {}).counties || {})[r.fips];
    const row = (lab, sh, cls) => `<tr class="${cls || ''}"><td>${lab}</td><td>${sh != null ? E.fmtPct(sh) : '—'}</td><td>${sh != null && r.V && cls !== 'live' ? E.fmtPts(r.A - sh) : ''}</td></tr>`;
    let h = `<h4>${esc(r.name)} County${r.split ? ' <span class="note">(part in district)</span>' : ''} ${vpill(r)}</h4>`;
    const q = E.reporting(r);
    h += `<div class="note" style="margin:0 0 6px">${q != null ? `<b style="color:var(--text,#e8edf2)">${Math.round(q)}% reporting</b>${r.split ? ' (whole county)' : ''}` : 'Reporting: not yet'}${r.V ? ` · ~${Math.round(r.f * 100)}% of expected vote counted (model)` : ''}</div>`;
    if (cb && cb.text) h += `<div class="ai">${esc(cb.text)}<small>Claude · ${fmtT(cb.at)}${cb.sig !== E.signature(r) ? ' · numbers have moved since' : ''}</small></div>`;
    else h += `<div class="note" style="font-size:12.5px">${esc(E.templateBlurb(r, m.res, m.o.rk))}</div>`;
    h += `<table><tr><td></td><td>Dem 2-party</td><td>Live vs.</td></tr>`;
    if (r.V) h += row('Live', r.A, 'live');
    h += row('Win pace', r.t);
    if (Math.abs((r.tLive || r.t) - r.t) >= 0.005) h += row('Win pace, turnout-adjusted', r.tLive);
    if (r.likelyEarly && r.tE != null && r.earlyDelta != null) h += row('Pace for early votes (2022 skew)', r.tE);
    if (r.tAlt != null && m.res.altLabel) h += row(esc(m.res.altLabel), r.tAlt);
    if (cmp.y2024) h += row(esc(cmp.y2024.label), cmp.y2024.share);
    if (cmp.y2024same && cmp.y2024same.k !== (cmp.y2024 || {}).k) h += row(esc(cmp.y2024same.label), cmp.y2024same.share);
    if (cmp.y2022) h += row(esc(cmp.y2022.label), cmp.y2022.share);
    if (cmp.hwm16) h += row('Best since 2016: ' + esc(cmp.hwm16.label), cmp.hwm16.share);
    if (cmp.hwm && (!cmp.hwm16 || cmp.hwm.label !== cmp.hwm16.label)) h += row('Best since 2006: ' + esc(cmp.hwm.label), cmp.hwm.share);
    h += `</table>`;
    el.innerHTML = h;
  }

  function tip(ev, m, fips) {
    const r = m.res.rows.find(x => x.fips === fips); if (!r) return;
    const t = document.getElementById('ctw-tip');
    t.innerHTML = `<b>${esc(r.name)}</b>${r.split ? ' (part)' : ''}<br>` + (r.V ? `${esc(last(m.res.dem))} ${E.fmtPct(r.A)} · ${E.reporting(r) != null ? Math.round(E.reporting(r)) + '% reporting' : '~' + Math.round(r.f * 100) + '% of expected vote'}<br>Win pace ${E.fmtPct(r.t)} · ${E.fmtPts(r.dev)} pts${r.swing24 != null ? `<br>Shift vs. 2024: ${(Math.abs(r.swing24) * 100).toFixed(1)} pts toward ${r.swing24 >= 0 ? 'Dems' : 'GOP'}${r.likelyEarly ? ' (early votes)' : ''}` : ''}${r.turnout22 != null ? `<br>Turnout ~${Math.round(r.turnout22 * 100)}% of 2022` : ''}` : `No votes yet${E.reporting(r) != null ? ' · ' + Math.round(E.reporting(r)) + '% reporting' : ''} · needs ${E.fmtPct(r.t)} Dem`);
    t.style.display = 'block'; t.style.left = Math.min(innerWidth - 260, ev.clientX + 14) + 'px'; t.style.top = (ev.clientY + 14) + 'px';
  }

  async function refresh() {
    try { const r = await fetch(W.opts.base + 'model/blurbs.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) W.blurbs = await r.json(); } catch (e) { /* none yet */ }
    for (const m of Object.values(W.mounts)) if (m.res !== undefined || m.opts) try { paint(m); } catch (e) { console.error(e); }
  }


  // Text snapshot of every geography for the "Ask Claude" chat
  async function summary(question) {
    await ensureModel();
    const q = String(question || '').toLowerCase();
    const pct = x => (x * 100).toFixed(1) + '%';
    const pts = x => (x >= 0 ? '+' : '-') + Math.abs(x * 100).toFixed(1);
    const out = [];
    const states = ['GA', 'NC', 'OH', 'MI', 'TX', 'IA'];
    for (const st of states) {
      for (const o of options(st)) {
        const g = W.model.geos[o.geo];
        const raw = W.opts.getRaw(o.v);
        const race = raw ? C.toRace(raw, o.v) : null;
        const res = E.compute(g, race, { target: 0.5, raceKey: o.rk });
        const tot = res.cur.D + res.cur.R + res.cur.O;
        const head = `## ${o.v} (${g.name} ${RN[o.rk]})`;
        if (!res.nReporting) {
          // before votes: give the win-pace targets for the biggest counties plus any county named in the question
          const named0 = res.rows.filter(r => q && q.includes(r.name.toLowerCase()));
          const big = res.rows.slice().sort((a, b) => b.E - a.E).slice(0, 15);
          const tl = [...new Set(named0.concat(big))].map(r => {
            const c = E.comparisons(r, null, o.rk); const m = (2 * r.t - 1) * r.E;
            return `${r.name}${r.split ? ' (part)' : ''} | win pace ${pct(r.t)} | full-count target margin ${m >= 0 ? 'D+' : 'R+'}${Math.round(Math.abs(m))} on ~${Math.round(r.E)} two-party votes | ${c.y2024 ? c.y2024.label + ' ' + pct(c.y2024.share) : '-'} | ${c.y2022 ? c.y2022.label + ' ' + pct(c.y2022.share) : '-'} | ${c.hwm16 ? 'best since 2016 ' + c.hwm16.label + ' ' + pct(c.hwm16.share) : '-'}`;
          });
          out.push(`${head}: no votes counted yet. Win-pace targets (largest counties${named0.length ? ' + counties named in the question' : ''}):\n` + tl.join('\n'));
          continue;
        }
        const ind = Object.entries(res.cur.ind || {}).filter(([, v]) => v > 0.02 * tot).map(([k, v]) => `${k} ${v} (${pct(v / tot)})`).join(', ');
        const B = ((W.blurbs.entries || {})[o.v]) || {};
        const lines = [head,
          `${res.dem} (D) ${res.cur.D} (${pct(res.cur.D / tot)}) vs ${res.rep} (R) ${res.cur.R} (${pct(res.cur.R / tot)})${ind ? '; others: ' + ind : ''}`,
          `${(RRq => RRq.pct != null ? Math.round(RRq.pct) + '% reporting (' + RRq.source + '), ' + RRq.full + '/' + RRq.n + ' counties fully in; ' : '')(E.raceReporting(race, res))}~${Math.round(res.counted * 100)}% of expected vote counted (model); ${res.nReporting}/${res.nCounties} counties reporting. Model projection ${res.projMargin >= 0 ? 'D' : 'R'}+${Math.abs(res.projMargin * 100).toFixed(1)} (outlook: ${res.outlook}). Counties ahead/on/behind win pace: ${res.tally.good}/${res.tally.neutral}/${res.tally.bad}.`];
        lines.push(`Alt model v2 (testing; projects uncounted counties from their own county type): ${res.v2.margin >= 0 ? 'D' : 'R'}+${Math.abs(res.v2.margin * 100).toFixed(1)}, 90% range ${pct(res.v2.lo)} to ${pct(res.v2.hi)} Dem two-party.${res.tally.goodEarly ? ` ${res.tally.goodEarly} more counties are ahead of pace on likely early votes only (not counted above).` : ''}${res.earlyWindow ? ' Within 45 min of poll close: all counties treated as likely early votes only.' : ''}`);
        const sp = res.shiftPanel.filter(x => x.done > 0);
        if (sp.length) lines.push('Fully counted counties by type, observed shift vs needed (log-odds; 0.1 ~ 2.5 pts in a 50/50 county): ' + sp.map(x => `${x.label} ${x.done}/${x.counties} done: ${x.observedShift.toFixed(3)} vs ${x.neededShift.toFixed(3)}`).join('; '));
        if (B.outlook && B.outlook.text) lines.push(`AI outlook note: ${B.outlook.text}`);
        // county lines: biggest movers plus any county named in the question
        const named = res.rows.filter(r => q && q.includes(r.name.toLowerCase()));
        const movers = res.rows.filter(r => r.V > 0).sort((a, b) => Math.abs(b.paceNet) - Math.abs(a.paceNet)).slice(0, o.geo.length === 2 ? 25 : 30);
        const left = res.rows.filter(r => !r.complete).map(r => ({ r, rem: Math.max(0, r.E - (r.V || 0)) })).sort((a, b) => b.rem - a.rem).slice(0, 8);
        lines.push('Largest uncounted vote: ' + left.map(({ r, rem }) => `${r.name} ~${Math.round(rem)} left (pace ${pct(r.t)}${r.V ? ', running ' + pts(r.dev) : ', nothing in'})`).join('; '));
        lines.push('County | % in (model est.; official % reporting in brackets) | Dem 2-party | win pace | vs pace pts | net votes vs pace | 2024 | 2022 | best since 2016 | verdict');
        for (const r of [...new Set(named.concat(movers))]) {
          const c = E.comparisons(r, null, o.rk);
          lines.push(`${r.name}${r.split ? ' (part)' : ''} | ${r.V ? Math.round(r.f * 100) + '%' : '0%'}${E.reporting(r) != null ? ' [' + Math.round(E.reporting(r)) + '%]' : ''} | ${r.V ? pct(r.A) : '-'} | ${pct(r.t)} | ${r.V ? pts(r.dev) : '-'} | ${r.V ? Math.round(r.paceNet) : '-'} | ${c.y2024 ? c.y2024.label + ' ' + pct(c.y2024.share) : '-'} | ${c.y2022 ? c.y2022.label + ' ' + pct(c.y2022.share) : '-'} | ${c.hwm16 ? c.hwm16.label + ' ' + pct(c.hwm16.share) : '-'} | ${r.verdict}${r.likelyEarly ? ' (likely early votes only)' : ''}${r.lowImpact ? ' (low impact)' : ''}`);
        }
        out.push(lines.join('\n'));
      }
    }
    return out.join('\n\n');
  }

  window.CTWidget = {
    init(opts) { W.opts = Object.assign({ base: 'data/' }, opts); },
    mount, refresh, summary, mounted: st => !!W.mounts[st]
  };
})();
