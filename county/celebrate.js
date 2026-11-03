/* Full-screen celebration when a SAM target race is called for a Democrat.
   CTCelebrate.enqueue({ race, winner, sub, by }) — shows one at a time; several calls at once play in sequence.
   Confetti (canvas) + rising balloons; tap or Esc to skip. Reduced-motion users get the card without the animation. */
(function () {
  const CSS = `
  #cel { position: fixed; inset: 0; z-index: 9999; display: none; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(23,54,93,.92) 0%, rgba(8,12,18,.96) 70%); cursor: pointer; overflow: hidden; }
  #cel.on { display: flex; animation: celIn .35s ease-out; }
  #cel.out { animation: celOut .45s ease-in forwards; }
  @keyframes celIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes celOut { to { opacity: 0 } }
  #cel canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  #cel .cel-card { position: relative; z-index: 2; text-align: center; color: #fff; padding: 28px 34px; max-width: min(92vw, 860px); animation: celPop .7s cubic-bezier(.2,1.6,.4,1) both .1s; }
  @keyframes celPop { from { transform: scale(.4) rotate(-4deg); opacity: 0 } to { transform: scale(1) rotate(0); opacity: 1 } }
  #cel .kick { display: inline-block; font: 800 clamp(14px, 2.2vw, 20px)/1 system-ui,-apple-system,sans-serif; letter-spacing: .22em; text-transform: uppercase; color: #ffd166; padding: 8px 14px; border: 2px solid #ffd166; border-radius: 999px; margin-bottom: 18px; }
  #cel .race { font: 900 clamp(56px, 13vw, 150px)/0.95 system-ui,-apple-system,sans-serif; letter-spacing: -.02em; text-shadow: 0 6px 30px rgba(0,0,0,.45); background: linear-gradient(180deg, #ffffff 0%, #bcd6ff 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  #cel .who { font: 800 clamp(24px, 5vw, 52px)/1.1 system-ui,-apple-system,sans-serif; margin-top: 14px; }
  #cel .who .d { display: inline-block; background: #3a78c9; color: #fff; border-radius: 8px; padding: 0 12px; margin-left: 8px; font-size: .8em; vertical-align: .08em; }
  #cel .sub { font: 600 clamp(15px, 2.3vw, 22px)/1.35 system-ui,-apple-system,sans-serif; color: #dbe6f3; margin-top: 14px; }
  #cel .by { font: 500 clamp(12px, 1.6vw, 15px)/1.3 system-ui,-apple-system,sans-serif; color: #9fb3c8; margin-top: 18px; }
  #cel .q { position: absolute; bottom: 18px; left: 0; right: 0; text-align: center; color: #9fb3c8; font: 500 13px system-ui,sans-serif; z-index: 2; }
  .bal { position: absolute; bottom: -160px; z-index: 1; will-change: transform; animation: balUp linear forwards; }
  .bal i { display: block; border-radius: 50% 50% 48% 52% / 58% 58% 42% 42%; box-shadow: inset -10px -14px 0 rgba(0,0,0,.14), inset 8px 8px 14px rgba(255,255,255,.35); position: relative; }
  .bal i::after { content: ''; position: absolute; left: 50%; bottom: -6px; margin-left: -5px; border: 5px solid transparent; border-bottom-color: inherit; }
  .bal b { display: block; width: 1.5px; height: 90px; margin: 4px auto 0; background: rgba(255,255,255,.55); transform-origin: top; animation: balStr 1.6s ease-in-out infinite alternate; }
  @keyframes balUp { 0% { transform: translate(0, 0) rotate(-3deg) } 50% { transform: translate(var(--sx), -60vh) rotate(4deg) } 100% { transform: translate(calc(var(--sx) * -0.5), -125vh) rotate(-2deg) } }
  @keyframes balStr { from { transform: rotate(-6deg) } to { transform: rotate(6deg) } }
  @media (max-width: 600px) { #cel .kick { letter-spacing: .1em; font-size: 12px } }
  @media (prefers-reduced-motion: reduce) { #cel .cel-card { animation: none } .bal { display: none } }`;
  const COLORS = ['#3a78c9', '#5fa3ff', '#ffd166', '#ffffff', '#7dd3c8', '#ff8fab', '#b39ddb'];
  const BAL_COLORS = ['#3a78c9', '#4f86cf', '#5fa3ff', '#ffd166', '#ffffff', '#2f6bc0'];
  const queue = []; let busy = false, el = null, skip = null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function setup() {
    if (el) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement('div'); el.id = 'cel'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-live', 'assertive');
    document.body.appendChild(el);
    el.addEventListener('click', () => skip && skip());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && skip) skip(); });
  }

  function confetti(canvas, ms) {
    const ctx = canvas.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
    const W = canvas.width = innerWidth * dpr, H = canvas.height = innerHeight * dpr;
    const P = [];
    const burst = (x, y, dir, n) => { for (let i = 0; i < n; i++) { const a = (-Math.PI / 2) + dir * (0.25 + Math.random() * 0.55), v = (9 + Math.random() * 13) * dpr;
      P.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: (6 + Math.random() * 7) * dpr, h: (3 + Math.random() * 5) * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .35, c: COLORS[(Math.random() * COLORS.length) | 0], t: Math.random() * 6 }); } };
    burst(0, H, 1, 140); burst(W, H, -1, 140);
    const t0 = performance.now(); let raf, second = false;
    (function frame(t) {
      if (!second && t - t0 > 900) { second = true; burst(W * 0.25, H, 0.35, 70); burst(W * 0.75, H, -0.35, 70); }
      ctx.clearRect(0, 0, W, H);
      for (const p of P) {
        p.vy += 0.32 * dpr; p.vx *= 0.99; p.vy *= 0.99; p.x += p.vx + Math.sin((t / 300) + p.t) * 0.6 * dpr; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(t / 160 + p.t)); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (t - t0 < ms) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
    return () => cancelAnimationFrame(raf);
  }

  function balloons(host, n) {
    for (let i = 0; i < n; i++) {
      const b = document.createElement('div'); b.className = 'bal';
      const size = 46 + Math.random() * 38, c = BAL_COLORS[(Math.random() * BAL_COLORS.length) | 0];
      b.style.left = (Math.random() * 96) + 'vw'; b.style.setProperty('--sx', ((Math.random() - .5) * 120) + 'px');
      b.style.animationDuration = (5.5 + Math.random() * 3) + 's'; b.style.animationDelay = (Math.random() * 1.4) + 's';
      b.innerHTML = `<i style="width:${size}px;height:${size * 1.2}px;background:${c};border-bottom-color:${c};color:${c}"></i><b></b>`;
      b.querySelector('i').style.borderBottomColor = c;
      host.appendChild(b);
    }
  }

  function show(item) {
    return new Promise(resolve => {
      setup();
      el.className = 'on';
      el.innerHTML = `<canvas></canvas><div class="cel-card"><div class="kick">${esc(item.kick || 'Race called · SAM target')}</div>
        <div class="race">${esc(item.race)}</div>
        <div class="who">${esc(item.winner)}<span class="d">D</span></div>
        ${item.sub ? `<div class="sub">${esc(item.sub)}</div>` : ''}
        ${item.by ? `<div class="by">${esc(item.by)}</div>` : ''}</div>
        <div class="q">${queue.length ? `${queue.length} more call${queue.length > 1 ? 's' : ''} up next · ` : ''}tap to ${queue.length ? 'skip' : 'close'}</div>`;
      const dur = reduced() ? 4500 : 7000;
      const stop = reduced() ? () => {} : confetti(el.querySelector('canvas'), dur - 600);
      if (!reduced()) balloons(el, innerWidth < 600 ? 10 : 18);
      let done = false;
      const finish = () => { if (done) return; done = true; stop(); clearTimeout(tm); el.classList.add('out'); setTimeout(() => { el.className = ''; el.innerHTML = ''; resolve(); }, 450); };
      const tm = setTimeout(finish, dur);
      skip = finish;
    });
  }

  async function run() {
    if (busy) return; busy = true;
    while (queue.length) { const it = queue.shift(); await show(it); await new Promise(r => setTimeout(r, 350)); }
    busy = false; skip = null;
  }
  function enqueue(item) {
    queue.push(item);
    const q = el && el.querySelector('.q'); if (q && busy) q.textContent = `${queue.length} more call${queue.length > 1 ? 's' : ''} up next · tap to skip`;
    setTimeout(run, 0);        // let calls that arrive together queue up before the first one shows
  }
  window.CTCelebrate = { enqueue };
})();
