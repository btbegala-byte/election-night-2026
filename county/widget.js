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
  .ctw .seg{display:inline-flex;border:1px solid var(--line,#2a3542);border-radius:6px;overflow:hidden}
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
  function fill(r, mode) {
    if (mode === 'target') return Math.abs(r.t - 0.5) < 0.01 ? COL.mid : ramp(r.t - 0.5, 0.25);
    if (!r.V) return COL.wait;
    if (mode === 'result') return Math.abs(r.A - 0.5) < 0.01 ? COL.mid : ramp(r.A - 0.5, 0.25);
    if (r.verdict === 'good' || r.verdict === 'bad') return ramp(r.dev, 0.10);
    return COL.mid;
  }
  const pill = (v, txt) => `<span class="pill ${v}">${{ good: '▲', bad: '▼', neutral: '●' }[v] || '◌'} ${txt || { good: 'Ahead of win pace', bad: 'Behind win pace', neutral: 'On pace', early: 'Too early', waiting: 'No votes yet' }[v]}</span>`;
  const fmtT = iso => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };

  function options(st) {
    const out = [];
    const g = W.model.geos[st];
    for (const rk of g.races) out.push({ v: `${st}-${rk}`, geo: st, rk, label: `${RN[rk]}${rk === 'SEN' && st === 'OH' ? ' (special)' : ''} · statewide` });
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
    const m = W.mounts[st] = { el, st, sel: opts[0].v, mode: 'pace', county: null, opts };
    el.innerHTML = `<div class="ctw">
      <div class="ctw-top"><span class="t">County targets</span>
        <select aria-label="Race">${opts.map(o => `<option value="${o.v}">${esc(o.label)}</option>`).join('')}</select>
        <span class="seg"><button data-m="pace" class="on">vs. win pace</button><button data-m="result">Result</button><button data-m="target">Win pace</button></span>
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
    svg.append('g').selectAll('path').data(fc.features.filter(f => !inGeo.has(f.id))).join('path').attr('class', 'off').attr('d', path);
    svg.append('g').attr('class', 'cp').selectAll('path').data(fc.features.filter(f => inGeo.has(f.id)), d => d.id).join('path').attr('class', 'c').attr('d', path)
      .on('mousemove', (ev, d) => tip(ev, m, d.id)).on('mouseleave', () => { document.getElementById('ctw-tip').style.display = 'none'; })
      .on('click', (ev, d) => { m.county = d.id; paint(m); detail(m); });
    svg.append('g').attr('pointer-events', 'none').selectAll('path').data(fc.features.filter(f => (g.counties.find(c => c.fips === f.id) || {}).split))
      .join('path').attr('d', path).attr('fill', `url(#h-${m.st})`);
    m.el.querySelector('a.full').href = `county/?geo=${o.geo}${o.rk !== 'HOUSE' ? '&race=' + o.rk : ''}`;
    paint(m);
  }

  function compute(m) {
    const o = cur(m), g = W.model.geos[o.geo];
    const raw = W.opts.getRaw(o.v);
    m.race = raw ? C.toRace(raw, o.v) : null;
    m.res = E.compute(g, m.race, { target: 0.5 });
    m.g = g; m.o = o;
  }

  function paint(m) {
    compute(m);
    const by = Object.fromEntries(m.res.rows.map(r => [r.fips, r]));
    d3.select(m.el).select('g.cp').selectAll('path').attr('fill', d => by[d.id] ? fill(by[d.id], m.mode) : COL.wait)
      .classed('sel', d => d.id === m.county).filter(d => d.id === m.county).raise();
    const sw = (c, t) => `<i style="background:${c}"></i>${t}`;
    let lg = m.mode === 'pace' ? `${sw(COL.r[3], '')}${sw(COL.r[1], 'Behind win pace')} ${sw(COL.mid, 'On pace')} ${sw(COL.d[1], 'Ahead')}${sw(COL.d[3], '')} ${sw(COL.wait, 'No votes')}`
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
    h += `<div class="kvs"><div>Expected vote in<b>${Math.round(r.counted * 100)}%</b></div>
      <div>${esc(last(r.dem))}<b>${tot ? E.fmtPct(r.cur.D / tot) : '—'}</b></div><div>${esc(last(r.rep))}<b>${tot ? E.fmtPct(r.cur.R / tot) : '—'}</b></div>
      ${ind && ind[1] > 0.05 * tot ? `<div>${esc(last(ind[0]))}<b>${E.fmtPct(ind[1] / tot)}</b></div>` : ''}
      <div>Ahead / on / behind<b>${r.tally.good} / ${r.tally.neutral} / ${r.tally.bad}</b></div></div>`;
    if (B.outlook && B.outlook.text) h += `<div class="ai">${esc(B.outlook.text)}<small>Claude · ${fmtT(B.outlook.at)}${B.outlook.counted != null ? ` · at ${Math.round(B.outlook.counted * 100)}% in` : ''}</small></div>`;
    if (r.nReporting) {
      const li = a => a.map(x => `<a data-f="${x.fips}">${esc(x.name)}<span>${x.paceNet >= 0 ? '+' : '−'}${E.fmtN(Math.abs(x.paceNet))}</span></a>`).join('') || '<span class="note">—</span>';
      h += `<div class="lists"><div><h4>Beating win pace</h4>${li(r.helping.slice(0, 4))}</div><div><h4>Trailing win pace</h4>${li(r.hurting.slice(0, 4))}</div></div>`;
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
    let h = `<h4>${esc(r.name)} County${r.split ? ' <span class="note">(part in district)</span>' : ''} ${pill(r.verdict)}</h4>`;
    if (cb && cb.text) h += `<div class="ai">${esc(cb.text)}<small>Claude · ${fmtT(cb.at)}${cb.sig !== E.signature(r) ? ' · numbers have moved since' : ''}</small></div>`;
    else h += `<div class="note" style="font-size:12.5px">${esc(E.templateBlurb(r, m.res, m.o.rk))}</div>`;
    h += `<table><tr><td></td><td>Dem 2-party</td><td>Live vs.</td></tr>`;
    if (r.V) h += row(`Live (~${Math.round(r.f * 100)}% in)`, r.A, 'live');
    h += row('Win pace', r.t);
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
    t.innerHTML = `<b>${esc(r.name)}</b>${r.split ? ' (part)' : ''}<br>` + (r.V ? `${esc(last(m.res.dem))} ${E.fmtPct(r.A)} · ~${Math.round(r.f * 100)}% in<br>Win pace ${E.fmtPct(r.t)} · ${E.fmtPts(r.dev)} pts` : `No votes yet · needs ${E.fmtPct(r.t)} Dem`);
    t.style.display = 'block'; t.style.left = Math.min(innerWidth - 260, ev.clientX + 14) + 'px'; t.style.top = (ev.clientY + 14) + 'px';
  }

  async function refresh() {
    try { const r = await fetch(W.opts.base + 'model/blurbs.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) W.blurbs = await r.json(); } catch (e) { /* none yet */ }
    for (const m of Object.values(W.mounts)) if (m.res !== undefined || m.opts) try { paint(m); } catch (e) { console.error(e); }
  }

  window.CTWidget = {
    init(opts) { W.opts = Object.assign({ base: 'data/' }, opts); },
    mount, refresh, mounted: st => !!W.mounts[st]
  };
})();
