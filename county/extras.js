/* Shared pieces for both county maps (dashboard widget and the Detailed Map View):
   - whereLeft(): "Where the vote is left" — counted vs. projected-remaining bars and the counties with the most vote still out
   - shiftColor() / arrows(): shift vs. 2024 coloring and WaPo-style shift arrows
   - turnoutColor(): turnout vs. 2022 coloring
   Styling uses the host page's CSS variables, with fallbacks for each theme. */
(function () {
  const CSS = `
  .wl { margin-top: 12px; }
  .wl h4 { margin: 0 0 6px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted, var(--ink3, #8a99a8)); font-weight: 600; }
  .wl .bars { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px; align-items: center; font-size: 12.5px; margin-bottom: 8px; }
  .wl .bar { display: block; width: 100%; min-width: 120px; position: relative; height: 12px; border-radius: 3px; background: rgba(128,140,155,.15); overflow: hidden; }
  .wl .bar i { position: absolute; top: 0; bottom: 0; left: 0; }
  .wl .bar i.rem { opacity: .38; background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 2px, transparent 2px 5px); }
  .wl .bars .nm { white-space: nowrap; }
  .wl .bars .v { white-space: nowrap; color: var(--muted, var(--ink2, #8a99a8)); font-variant-numeric: tabular-nums; }
  .wl table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .wl td, .wl th { padding: 4px 6px 4px 0; text-align: left; border-bottom: 1px solid rgba(128,140,155,.18); }
  .wl th { font-weight: 600; color: var(--muted, var(--ink3, #8a99a8)); font-size: 11.5px; }
  .wl td.n, .wl th.n { text-align: right; }
  .wl .d { color: var(--dem, #4f86cf); font-weight: 600; } .wl .r { color: var(--rep, #d0464f); font-weight: 600; }
  .wl .note { font-size: 11.5px; color: var(--muted, var(--ink3, #8a99a8)); margin-top: 5px; }
  .wl a { cursor: pointer; color: inherit; text-decoration: underline dotted; }`;
  function ensureCss() { if (!document.getElementById('ctx-css')) { const s = document.createElement('style'); s.id = 'ctx-css'; s.textContent = CSS; document.head.appendChild(s); } }

  const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
  const mg = (d, r) => { const t = d + r; if (!t) return '—'; const m = (d - r) / t * 100; return `<span class="${m >= 0 ? 'd' : 'r'}">${m >= 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}</span>`; };
  const last = n => String(n || '').split(' ').slice(-1)[0];

  // res: engine result; E: the engine (for comparisons); opts.rk race key; opts.n rows to list
  function whereLeft(res, E, opts) {
    ensureCss(); opts = opts || {};
    if (!res || !res.nReporting) return '';
    const P = res.proj || {}, cur = res.cur;
    const mx = Math.max(P.D || 0, P.R || 0, 1);
    const bar = (lab, now, rem, col) => `<span class="nm">${lab}</span><span class="bar"><i style="width:${(100 * now / mx).toFixed(2)}%;background:${col}"></i><i class="rem" style="left:${(100 * now / mx).toFixed(2)}%;width:${(100 * rem / mx).toFixed(2)}%;background:${col}"></i></span><span class="v">${fmtK(now)} + ~${fmtK(rem)}</span>`;
    const left = res.rows.filter(r => !r.complete && (r.rem || 0) > 0).sort((a, b) => b.rem - a.rem).slice(0, opts.n || 8);
    const totLeft = res.rows.reduce((a, r) => a + (r.complete ? 0 : (r.rem || 0)), 0);
    const rowsH = left.map(r => {
      const c = E.comparisons(r, null, opts.rk), p24 = c.y2024;
      const q = E.reporting ? E.reporting(r) : null;
      return `<tr><td>${opts.link ? `<a data-f="${r.fips}">${r.name}</a>` : r.name}${r.split ? '*' : ''}</td><td class="n">~${fmtK(r.rem)}</td>
        <td class="n">${q != null ? Math.round(q) + '%' : r.V ? '~' + Math.round(r.f * 100) + '%' : '0%'}</td>
        <td class="n">${r.V ? mg(r.live.D, r.live.R) : '<span style="opacity:.6">none yet</span>'}</td>
        <td class="n">${p24 ? mg(p24.d, p24.r) : '—'}</td><td class="n">${(r.t * 100).toFixed(1)}%</td></tr>`;
    }).join('');
    return `<div class="wl"><h4>Where the vote is left</h4>
      <div class="bars">${bar(last(res.dem) + ' (D)', cur.D, P.remD || 0, 'var(--dem, #4f86cf)')}${bar(last(res.rep) + ' (R)', cur.R, P.remR || 0, 'var(--rep, #d0464f)')}</div>
      <table><tr><th>County</th><th class="n">Est. left</th><th class="n">In</th><th class="n">Now</th><th class="n">2024 Pres</th><th class="n">Win pace</th></tr>${rowsH}</table>
      <div class="note">Solid = counted; striped = model estimate of the vote still out and how it breaks. About ${fmtK(totLeft)} two-party votes left statewide by the model's estimate. "Now" is the county's current margin; win pace is the Dem share it needs.</div></div>`;
  }

  // shift vs. 2024 (Dem two-party share points); returns null when there is nothing to compare
  function shift24(r) { return r && r.V > 0 && r.swing24 != null && r.f >= 0.03 ? r.swing24 : null; }

  // WaPo-style arrows: angled up-left for a shift toward Dems, up-right toward GOP; length ~ size of the shift
  function arrows(layer, path, feats, byF, opts) {
    opts = opts || {};
    const g = layer.append('g').attr('class', 'shift-arrows').attr('pointer-events', 'none');
    const unit = opts.unit || 2.2;                   // map units per point of shift
    for (const f of feats) {
      const r = byF[f.id], sw = shift24(r); if (sw == null) continue;
      const pts = Math.max(-15, Math.min(15, sw * 100));
      if (Math.abs(pts) < 0.3) continue;
      const c = path.centroid(f); if (!c || isNaN(c[0])) continue;
      const L = Math.min(40, 6 + Math.abs(pts) * unit), dir = pts > 0 ? -1 : 1;
      const dx = dir * L * 0.82, dy = -L * 0.57;
      const col = pts > 0 ? (opts.dem || '#4f86cf') : (opts.rep || '#d65a63');
      const x2 = c[0] + dx, y2 = c[1] + dy, a = Math.atan2(dy, dx), h = opts.head || 7;
      g.append('line').attr('x1', c[0]).attr('y1', c[1]).attr('x2', x2).attr('y2', y2).attr('stroke', col).attr('stroke-width', 2)
        .attr('stroke-linecap', 'round').attr('vector-effect', 'non-scaling-stroke').attr('opacity', r.likelyEarly ? 0.5 : 0.95);
      g.append('path').attr('d', `M${x2},${y2} L${x2 - h * Math.cos(a - 0.45)},${y2 - h * Math.sin(a - 0.45)} L${x2 - h * Math.cos(a + 0.45)},${y2 - h * Math.sin(a + 0.45)} Z`)
        .attr('fill', col).attr('opacity', r.likelyEarly ? 0.5 : 0.95);
    }
    return g;
  }

  window.CTExtras = { whereLeft, shift24, arrows, fmtK };
})();
