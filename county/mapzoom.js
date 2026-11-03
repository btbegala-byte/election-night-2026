/* Pinch/drag/wheel zoom for the county maps, tuned for touch screens.
   - Pinch (two fingers) zooms anywhere; one-finger drag pans only once zoomed in, so the page still scrolls normally.
   - Double-tap / double-click zooms in; +, − and reset buttons sit in the map's corner.
   - Taps on counties still select them (drags of more than a few pixels don't count as taps). */
(function () {
  const CSS = `
  .mz-ctl{position:absolute;top:8px;right:8px;display:flex;flex-direction:column;gap:6px;z-index:5}
  .mz-ctl button{width:36px;height:36px;border-radius:8px;border:1px solid rgba(128,140,155,.45);background:rgba(23,30,38,.88);color:#e8edf2;font:600 18px/1 system-ui,sans-serif;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center}
  .mz-ctl button:hover{border-color:#4F81BD}
  .mz-ctl button.reset{font-size:15px}
  .mz-hint{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);background:rgba(15,20,25,.85);color:#e8edf2;font:12px system-ui,sans-serif;padding:4px 10px;border-radius:999px;pointer-events:none;opacity:0;transition:opacity .3s}
  .mz-hint.show{opacity:1}
  @media (prefers-color-scheme: light){ .mz-ctl.light button{background:rgba(252,252,251,.92);color:#0b0b0b} }`;
  let injected = false;

  function attach(svgNode, layerNode, opts) {
    if (!injected) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); injected = true; }
    opts = opts || {};
    const svg = d3.select(svgNode), layer = d3.select(layerNode);
    const vb = (svgNode.getAttribute('viewBox') || '0 0 900 640').split(/\s+/).map(Number);
    const W = vb[2], H = vb[3];
    const host = opts.container || svgNode.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.querySelectorAll(':scope > .mz-ctl, :scope > .mz-hint').forEach(n => n.remove());

    let k = 1;
    const setTouch = () => svg.style('touch-action', k > 1.01 ? 'none' : 'pan-y');
    const zoom = d3.zoom()
      .scaleExtent([1, 12])
      .translateExtent([[0, 0], [W, H]])
      .extent([[0, 0], [W, H]])
      .clickDistance(6)
      .tapDistance(10)
      .filter(ev => {
        if (ev.type === 'wheel') return ev.ctrlKey || ev.metaKey || k > 1.01;          // plain wheel scrolls the page until zoomed in
        if (ev.type === 'touchstart') return k > 1.01;                                    // unzoomed: page scrolls; pinch handled below
        if (ev.type === 'dblclick') return true;
        return (!ev.ctrlKey || ev.type === 'wheel') && !ev.button;
      })
      .on('zoom', ev => { k = ev.transform.k; layer.attr('transform', ev.transform); setTouch(); host.classList.toggle('mz-zoomed', k > 1.01); });
    svg.call(zoom).on('dblclick.zoom', null);
    // double-tap / double-click zooms in around the point
    svg.on('dblclick.mz', ev => { ev.preventDefault(); const p = d3.pointer(ev, svgNode); svg.transition().duration(250).call(zoom.scaleBy, 2, p); });
    setTouch();

    // pinch from the unzoomed state (d3 only takes over touches once the map is zoomed in)
    let pinch = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a, b) => ({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
    svgNode.addEventListener('touchstart', e => {
      if (k <= 1.01 && e.touches.length === 2) { pinch = { d: dist(e.touches[0], e.touches[1]) || 1, k0: k }; e.preventDefault(); }
    }, { passive: false });
    svgNode.addEventListener('touchmove', e => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const s = dist(e.touches[0], e.touches[1]) / pinch.d;
      const p = d3.pointer(mid(e.touches[0], e.touches[1]), svgNode);
      svg.call(zoom.scaleTo, Math.max(1, Math.min(12, pinch.k0 * s)), p);
    }, { passive: false });
    svgNode.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });

    const ctl = document.createElement('div');
    ctl.className = 'mz-ctl' + (opts.light ? ' light' : '');
    ctl.innerHTML = '<button aria-label="Zoom in" title="Zoom in">+</button><button aria-label="Zoom out" title="Zoom out">−</button><button class="reset" aria-label="Reset zoom" title="Reset">⟲</button>';
    const [bin, bout, brs] = ctl.querySelectorAll('button');
    bin.onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.8);
    bout.onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.8);
    brs.onclick = () => svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
    host.appendChild(ctl);

    // one-time hint on touch devices
    if (matchMedia('(pointer: coarse)').matches && !attach._hinted) {
      attach._hinted = true;
      const h = document.createElement('div'); h.className = 'mz-hint'; h.textContent = 'Pinch to zoom · drag to pan when zoomed';
      host.appendChild(h); setTimeout(() => h.classList.add('show'), 300); setTimeout(() => h.classList.remove('show'), 3800);
    }
    return { reset: () => svg.call(zoom.transform, d3.zoomIdentity) };
  }
  window.CTZoom = { attach };
})();
