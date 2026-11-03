/* National map for the All states view: SAM's six states on a U.S. map, colored by the live result of the
   chosen office (Senate, Governor, or SAM's U.S. House target districts). Clicking a state or district jumps to
   its results card below the map. House districts are drawn from their counties (split counties hatched),
   the same convention as the state maps. */
(function () {
  const SAM = ['GA', 'NC', 'OH', 'MI', 'TX', 'IA'];
  const FIPS = { GA: '13', NC: '37', OH: '39', MI: '26', TX: '48', IA: '19' };
  const NAME = { GA: 'Georgia', NC: 'North Carolina', OH: 'Ohio', MI: 'Michigan', TX: 'Texas', IA: 'Iowa' };
  // label anchors (lon, lat) where a state's centroid would sit badly (MI's falls in the lake)
  const ANCHOR = { GA: [-83.4, 32.6], NC: [-79.0, 35.45], OH: [-82.75, 40.3], MI: [-84.7, 43.3], TX: [-99.2, 31.2], IA: [-93.5, 42.0] };
  const proj = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);   // matches us-atlas states-albers-10m
  const path = d3.geoPath(proj), pathPre = d3.geoPath();                  // pathPre: already-projected state shapes
  const COL = {
    D: ['#b7cdee', '#7ea5dc', '#4f86cf'], R: ['#f1b9bd', '#e2858c', '#d65a63'], Dc: '#2f6bc0', Rc: '#c73a44', O: '#9a9fa8', Oc: '#7d828b',
    wait: '#3b4756', none: '#202a35', off: '#161d25', line: '#0f1419'
  };
  let S = null;

  const CSS = `
  .nat { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 0 0 18px; }
  .nat-head { display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; }
  .nat-head h2 { margin: 0; font-size: 18px; }
  .nat-head .sub { color: var(--muted); font-size: 13px; }
  .nat-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-left: auto; }
  .nat-seg button { background: transparent; color: var(--text); border: 0; padding: 7px 14px; font: inherit; font-size: 14px; cursor: pointer; }
  .nat-seg button + button { border-left: 1px solid var(--line); }
  .nat-seg button.on { background: var(--blue); color: #fff; }
  .nat-map { position: relative; margin-top: 8px; }
  .nat-map svg { width: 100%; height: auto; max-height: min(64vh, 620px); display: block; }
  .nat-map path.st { stroke: ${COL.line}; stroke-width: .7; }
  .nat-map path.st.sam { cursor: pointer; stroke: #c9d3dd; stroke-width: 1.4; }
  .nat-map path.st.sam:hover, .nat-map path.cd:hover { filter: brightness(1.18); }
  .nat-map path.cd { stroke: #0f1419; stroke-width: .35; cursor: pointer; }
  .nat-map path.cdline { fill: none; stroke: #e8edf2; stroke-width: 1.1; pointer-events: none; }
  .nat-map .lbl { pointer-events: none; }
  .nat-map .lbl text { paint-order: stroke; stroke: rgba(10,14,19,.92); stroke-width: 2.6px; stroke-linejoin: round; fill: #f4f7fa; font-family: system-ui,-apple-system,Segoe UI,sans-serif; }
  .nat-leg { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font-size: 12.5px; margin-top: 6px; align-items: center; }
  .nat-leg i { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: -2px; margin-right: 4px; }
  .nat-leg .ramp i { margin-right: 0; border-radius: 0; }
  .nat-leg .ramp { display: inline-flex; align-items: center; gap: 0; }
  .nat-leg .ramp span { margin-left: 5px; }
  #nat-tip { position: fixed; z-index: 40; pointer-events: none; display: none; background: #0b1016; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 13px; max-width: 280px; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
  #nat-tip b { display: block; margin-bottom: 3px; }
  #nat-tip .r { display: flex; justify-content: space-between; gap: 14px; }
  #nat-tip .m { color: var(--muted); font-size: 12px; margin-top: 3px; }
  .nat h3 { margin-top: 16px; }
  .card.flash { animation: natflash 1.6s ease; }
  @keyframes natflash { 0%,40% { box-shadow: 0 0 0 2px var(--warn); } 100% { box-shadow: 0 0 0 0 transparent; } }
  @media (max-width: 600px) { .nat-seg { margin-left: 0; width: 100%; } .nat-seg button { flex: 1; padding: 8px 6px; } .nat { padding: 12px; } }`;

  // ---- which races each office shows ----
  function racesFor(mode) {
    const R = S.api.races();
    if (mode === 'house') return R.filter(r => r.target).sort((a, b) => a.label.localeCompare(b.label));
    const re = mode === 'senate' ? /US Senate/ : /^Governor$/;
    return SAM.map(st => R.find(r => r.state === st && re.test(r.label || r.name) && !/Lieutenant|Board/.test(r.name))).filter(Boolean);
  }

  // ---- current state of one race: leader, margin, % in, call ----
  function status(r) {
    const d = S.api.data(r.id), call = S.api.call(r.id);
    if (!d || !d.candidates) return { kind: 'wait', r };
    const cs = d.candidates.map(c => ({ name: c.name, party: S.api.party(c.party), votes: +c.votes || 0 })).sort((a, b) => b.votes - a.votes);
    const tot = cs.reduce((a, c) => a + c.votes, 0), pr = +d.percent_reporting || 0;
    let winner = null;
    if (call && call.winner && !call.conflict) winner = cs.find(c => S.api.nameMatch(c.name, call.winner)) || null;
    if (!tot && !winner) return { kind: 'wait', r, cs, pr };
    const lead = winner || cs[0], second = cs.find(c => c !== lead) || { votes: 0 };
    const margin = tot ? (lead.votes - second.votes) / tot * 100 : 0;
    return { kind: winner ? 'called' : 'lead', r, cs, tot, pr, lead, margin, party: lead.party === 'D' || lead.party === 'R' ? lead.party : 'O', call };
  }
  function fill(s) {
    if (!s || s.kind === 'wait') return COL.wait;
    if (s.kind === 'called') return COL[s.party + 'c'];
    if (s.party === 'O') return COL.O;
    const m = Math.abs(s.margin);
    return COL[s.party][m < 3 ? 0 : m < 10 ? 1 : 2];
  }
  const short = s => !s || s.kind === 'wait' ? 'No votes yet' : (s.kind === 'called' ? '✓ ' : '') + `${s.party === 'O' ? (s.lead.name.split(' ').slice(-1)[0]) : s.party} +${s.margin.toFixed(1)}`;

  function tip(ev, s, title) {
    const t = document.getElementById('nat-tip');
    if (!s) { t.style.display = 'none'; return; }
    const esc = S.api.esc;
    let body;
    if (!s.cs || !s.cs.length) body = '<div class="m">No results yet</div>';
    else {
      const top = s.cs.slice(0, 3);
      body = top.map(c => `<div class="r"><span>${esc(c.name)} (${esc(c.party || '?')})</span><span>${s.tot ? (100 * c.votes / s.tot).toFixed(1) + '%' : '–'}</span></div>`).join('')
        + `<div class="m">${s.pr ? Math.round(s.pr) + '% in' : 'No votes counted yet'}${s.kind === 'called' ? ' · called for ' + esc(s.lead.name) : ''}</div>`;
    }
    t.innerHTML = `<b>${esc(title)}</b>${body}<div class="m">Click for the full result</div>`;
    t.style.display = 'block';
    const x = Math.min(ev.clientX + 14, innerWidth - 300), y = Math.min(ev.clientY + 14, innerHeight - 140);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }

  async function ensureGeo() {
    if (!S.us) S.us = await (await fetch('data/model/geo/US.json')).json();
    if (S.mode === 'house') {
      if (!S.model) S.model = await (await fetch('data/model/model.json')).json();
      for (const st of ['IA', 'MI', 'NC', 'OH', 'TX']) if (!S.cg[st]) S.cg[st] = await (await fetch(`data/model/geo/${st}.json`)).json();
    }
  }

  function pick(r) { if (S.api.onPick) S.api.onPick(r); }

  // ---- draw the map for the current mode ----
  function draw() {
    const svg = d3.select(S.el).select('.nat-map svg');
    // frame the six SAM states (with their neighbors around the edges) rather than the whole country
    const bb = pathPre.bounds({ type: 'FeatureCollection', features: S.us.features.filter(f => SAM.some(st => FIPS[st] === f.id)) });
    const pad = 36, x0 = bb[0][0] - pad, y0 = bb[0][1] - pad;
    S.vw = bb[1][0] - bb[0][0] + 2 * pad; S.vh = bb[1][1] - bb[0][1] + 2 * pad;
    svg.attr('viewBox', `0 0 ${S.vw} ${S.vh}`).selectAll('*').remove();
    const defs = svg.append('defs');
    defs.append('pattern').attr('id', 'nat-hatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 4).attr('height', 4)
      .attr('patternTransform', 'rotate(45)').append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 4).attr('stroke', '#0f1419').attr('stroke-opacity', .6).attr('stroke-width', 1.2);
    const zlOuter = svg.append('g'), zl = zlOuter.append('g').attr('transform', `translate(${-x0},${-y0})`);
    const races = racesFor(S.mode);
    const byState = {}; for (const r of races) if (S.mode !== 'house') byState[r.state] = r;
    const stOf = f => SAM.find(s => FIPS[s] === f.id);
    const stG = zl.append('g');
    S.states = stG.selectAll('path').data(S.us.features).join('path')
      .attr('d', pathPre)
      .attr('class', f => 'st' + (stOf(f) ? ' sam' : ''))
      .on('mousemove', (ev, f) => { const st = stOf(f); if (!st) return tip(ev, null);
        if (S.mode === 'house') { tip(ev, { cs: [] }, NAME[st]); document.querySelector('#nat-tip .m:last-child').textContent = 'SAM target districts are outlined'; return; }
        const r = byState[st]; if (!r) { tip(ev, { cs: [] }, `${NAME[st]} · no ${S.mode === 'gov' ? 'governor' : 'Senate'} race this year`); document.querySelector('#nat-tip .m:last-child').remove(); return; }
        tip(ev, status(r), `${NAME[st]} · ${r.label || r.name}`); })
      .on('mouseleave', () => tip(null, null))
      .on('click', (ev, f) => { const st = stOf(f); if (st && byState[st]) pick(byState[st]); });

    const labels = [];
    if (S.mode !== 'house') {
      S.states.attr('fill', f => { const st = stOf(f); if (!st) return COL.off; const r = byState[st]; return r ? fill(status(r)) : COL.none; });
      for (const st of SAM) {
        const r = byState[st], p = proj(ANCHOR[st]); if (!p) continue;
        const s = r ? status(r) : null;
        const text = () => { const s = r ? status(r) : null; return [st, r ? short(s) : 'No race', r && s.pr ? Math.round(s.pr) + '% in' : '']; };
        labels.push({ x: p[0], y: p[1], lines: text(), big: true, text });
      }
    } else {
      S.states.attr('fill', f => { const st = stOf(f); return !st ? COL.off : ['IA', 'MI', 'NC', 'OH', 'TX'].includes(st) ? COL.none : '#1a222b'; });
      const cdG = zl.append('g');
      for (const r of races) {
        const geoKey = r.label;                     // e.g. 'IA-01'
        const g = S.model.geos[geoKey]; if (!g) continue;
        const fc = S.cg[r.state]; const split = new Set(g.counties.filter(c => c.split).map(c => c.fips));
        const feats = fc.features.filter(f => g.counties.some(c => c.fips === f.id));
        const s = status(r), col = fill(s);
        cdG.append('g').attr('data-rid', r.id).selectAll('path').data(feats).join('path').attr('class', 'cd').attr('d', path).attr('fill', col)
          .on('mousemove', ev => tip(ev, status(r), `${r.label} (${NAME[r.state]})`)).on('mouseleave', () => tip(null, null)).on('click', () => pick(r));
        cdG.append('g').selectAll('path').data(feats.filter(f => split.has(f.id))).join('path').attr('d', path).attr('fill', 'url(#nat-hatch)').attr('pointer-events', 'none');
        // outline of the district's counties
        const whole = feats.filter(f => !split.has(f.id));
        const cen = d3.geoPath(proj).centroid({ type: 'FeatureCollection', features: whole.length ? whole : feats });
        labels.push({ x: cen[0], y: cen[1], lines: [r.label, short(s)], big: false, r, text: () => [r.label, short(status(r))] });
      }
    }
    // labels: constant on-screen size, nudged apart when they collide
    const lg = zl.append('g').attr('class', 'lbl');
    S.labels = labels.map(L => {
      const g = lg.append('g');
      const lead = g.append('line').attr('stroke', '#e8edf2').attr('stroke-width', 1).attr('stroke-opacity', .8).style('display', 'none');
      const dot = g.append('circle').attr('r', 2.2).attr('fill', '#e8edf2').style('display', 'none');
      const box = g.append('g');
      L.lines.forEach((t, i) => box.append('text').attr('text-anchor', 'middle').attr('y', i * 14)
        .style('font-size', i === 0 ? (L.big ? '15px' : '12px') : '12px').style('font-weight', i === 0 ? 700 : i === 1 ? 600 : 400).text(t));
      return { g, box, lead, dot, L };
    });
    S.zoom = window.CTZoom ? CTZoom.attach(svg.node(), zlOuter.node(), { container: S.el.querySelector('.nat-map'), onZoom: k => placeLabels(k) }) : null;
    placeLabels(1);
    if (!S.ro && window.ResizeObserver) { S.ro = new ResizeObserver(() => placeLabels()); S.ro.observe(svg.node()); }
    legend();
  }
  // Labels keep a constant on-screen size. District labels that would collide move out to the side on a short
  // leader line pointing at the district; state labels always sit on their state.
  function placeLabels(k) {
    if (k == null) k = S.k || 1; S.k = k;
    const svg = S.el.querySelector('.nat-map svg'), rc = svg.getBoundingClientRect();
    const px = rc.width ? Math.min(rc.width / S.vw, rc.height / S.vh) : 1;    // screen px per map unit (svg letterboxes when height-capped)
    const f = rc.width && rc.width < 500 ? 0.85 : 1;                         // label scale on phones
    const s = f / (k * Math.max(px, 0.05));
    const placed = [];
    const clash = b => placed.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    S.labels.forEach(({ g, box, lead, dot, L }) => {
      let bb; try { bb = box.node().getBBox(); } catch (e) { bb = { x: -20, y: -12, width: 40, height: 28 }; }
      const bw = bb.width * f + 4, bh = bb.height * f + 2, cx0 = (bb.x + bb.width / 2) * f, cy0 = (bb.y + bb.height / 2) * f;
      const ax = L.x * k * px, ay = L.y * k * px;                            // anchor in screen px (relative frame)
      const at = (ox, oy) => ({ x0: ax + ox - bw / 2, x1: ax + ox + bw / 2, y0: ay + oy - bh / 2, y1: ay + oy + bh / 2 });
      let off = [0, 0];
      if (!L.big) {
        const cands = [[0, 0]];
        for (const r of [1, 1.7, 2.5]) {
          const dx = (bw / 2 + 10) * r, dy = (bh / 2 + 8) * r;
          cands.push([dx, 0], [-dx, 0], [0, -dy], [0, dy], [dx, -dy], [-dx, -dy], [dx, dy], [-dx, dy]);
        }
        off = cands.find(c => !clash(at(c[0], c[1]))) || [0, 0];
      }
      placed.push(at(off[0], off[1]));
      g.attr('transform', `translate(${L.x},${L.y}) scale(${s})`);
      // box contents are in label units; one label unit = f screen px
      box.attr('transform', `translate(${off[0] / f - cx0 / f},${off[1] / f - cy0 / f})`);
      const moved = off[0] || off[1];
      dot.style('display', moved ? null : 'none');
      if (moved) {
        // stop the leader line at the edge of the label box
        const len = Math.hypot(off[0], off[1]), tx = Math.min(1, Math.max(0, 1 - Math.min(Math.abs(bw / 2 / (off[0] || 1e-9)), Math.abs(bh / 2 / (off[1] || 1e-9))) ));
        lead.style('display', null).attr('x1', 0).attr('y1', 0).attr('x2', off[0] * tx / f).attr('y2', off[1] * tx / f);
        if (len < 4) lead.style('display', 'none');
      } else lead.style('display', 'none');
    });
  }
  function legend() {
    const r = d3.select(S.el).select('.nat-leg');
    const ramp = p => `<span class="ramp">${COL[p].map(c => `<i style="background:${c}"></i>`).join('')}<i style="background:${COL[p + 'c']};margin-left:3px;border-radius:2px"></i><span>${p === 'D' ? 'Dem' : 'GOP'} leading (lighter = closer) · called</span></span>`;
    r.html(`${ramp('D')}${ramp('R')}<span><i style="background:${COL.wait}"></i>No votes yet</span>${S.mode === 'gov' ? `<span><i style="background:${COL.none};border:1px solid #c9d3dd"></i>No governor race (NC)</span>` : ''}${S.mode === 'house' ? '<span>District shapes are built from counties; hatched counties are split between districts.</span>' : ''}`);
  }

  // ---- results cards for the races on the map ----
  function cards() {
    const races = racesFor(S.mode);
    const title = { senate: 'U.S. Senate', gov: 'Governor', house: 'SAM target districts · U.S. House' }[S.mode];
    S.el.querySelector('.nat-cards').innerHTML = `<h3>${title}</h3><div class="grid">${races.map(r => S.api.card(r, S.mode === 'house' ? `${r.label}` : NAME[r.state] + (/special/i.test(r.name) ? ' (special)' : ''))).join('')}</div>`;
  }

  async function setMode(mode) {
    S.mode = mode;
    S.el.querySelectorAll('.nat-seg button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    if (S.api.onMode) S.api.onMode(mode);
    cards();
    await ensureGeo();
    draw();
  }

  async function mount(el, api, mode) {
    if (!document.getElementById('nat-css')) { const st = document.createElement('style'); st.id = 'nat-css'; st.textContent = CSS; document.head.appendChild(st); }
    if (!document.getElementById('nat-tip')) { const t = document.createElement('div'); t.id = 'nat-tip'; document.body.appendChild(t); }
    S = { el, api, mode: mode || 'senate', cg: {}, labels: [] };
    el.innerHTML = `<div class="nat-head"><h2>SAM target states</h2><span class="sub">Click a state or district for its result</span>
      <span class="nat-seg" role="tablist"><button data-m="senate">Senate</button><button data-m="gov">Governor</button><button data-m="house">U.S. House</button></span></div>
      <div class="nat-map"><svg role="img" aria-label="U.S. map of SAM's target states"></svg></div><div class="nat-leg"></div>
      <div class="nat-cards"></div>`;
    el.querySelectorAll('.nat-seg button').forEach(b => b.onclick = () => setMode(b.dataset.m));
    await setMode(S.mode);
  }
  // re-color, re-label and re-card after new results without redrawing, so the reader's zoom stays put
  function refresh() {
    if (!S || !S.us || !S.states) return;
    cards();
    const races = racesFor(S.mode), byState = {}; for (const r of races) byState[r.state] = r;
    if (S.mode !== 'house') S.states.attr('fill', f => { const st = SAM.find(x => FIPS[x] === f.id); if (!st) return COL.off; const r = byState[st]; return r ? fill(status(r)) : COL.none; });
    else d3.select(S.el).selectAll('.nat-map g[data-rid]').each(function () { const r = races.find(x => String(x.id) === this.getAttribute('data-rid')); if (r) d3.select(this).selectAll('path').attr('fill', fill(status(r))); });
    S.labels.forEach(({ box, L }) => { if (!L.text) return; const t = L.text(); box.selectAll('text').each(function (_, i) { this.textContent = t[i] || ''; }); }); placeLabels();
  }
  window.CTNational = { mount, refresh, mode: () => S && S.mode };
})();
