/* "Ask Claude" drawer for the results dashboard. Talks to the Cloudflare Worker in worker/chat-worker.js.
   Config: county/chat-config.json -> {"endpoint": "https://<worker>.workers.dev"} */
(function () {
  const CSS = `
  .askbtn{position:fixed;right:0;top:50%;transform:translateY(-50%) rotate(-90deg);transform-origin:right bottom;z-index:40;background:#17365D;color:#e8edf2;border:1px solid #4F81BD;border-bottom:0;border-radius:8px 8px 0 0;padding:7px 14px;font:600 13px Calibri,system-ui,sans-serif;cursor:pointer;letter-spacing:.3px}
  .askbtn:hover{background:#1f4677}
  .askpanel{position:fixed;top:0;right:0;height:100vh;width:min(420px,100vw);background:#141b22;border-left:1px solid #2a3542;z-index:45;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s ease;box-shadow:-8px 0 24px rgba(0,0,0,.35)}
  .askpanel.open{transform:none}
  .askpanel header{position:static;display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2a3542;background:#171e26}
  .askpanel header b{font-size:15px}
  .askpanel header span{color:#8a99a8;font-size:12px}
  .askpanel header button{margin-left:auto;background:transparent;border:0;color:#8a99a8;font-size:20px;cursor:pointer;padding:0 4px}
  .asklog{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
  .askmsg{font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
  .askmsg.u{align-self:flex-end;background:#17365D;border:1px solid #2c5288;padding:7px 10px;border-radius:10px 10px 2px 10px;max-width:85%}
  .askmsg.a{background:#1d2630;border:1px solid #2a3542;padding:8px 11px;border-radius:10px 10px 10px 2px}
  .askmsg.a small,.askmsg.e small{display:block;color:#8a99a8;font-size:11px;margin-top:4px}
  .askmsg.e{color:#f1b0b0;font-size:13px}
  .askhint{color:#8a99a8;font-size:12.5px}
  .askhint a{color:#86b6ef;cursor:pointer;display:block;margin-top:4px;text-decoration:none}
  .askform{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #2a3542;background:#171e26}
  .askform textarea{flex:1;resize:none;height:58px;background:#0f1419;color:#e8edf2;border:1px solid #2a3542;border-radius:8px;padding:7px 9px;font:14px Calibri,system-ui,sans-serif}
  .askform button{background:#4F81BD;color:#fff;border:0;border-radius:8px;padding:0 14px;font:600 14px Calibri,system-ui,sans-serif;cursor:pointer}
  .askform button:disabled{opacity:.5;cursor:default}
  .dots::after{content:'…';animation:askd 1s steps(3) infinite}
  @keyframes askd{0%{content:'.'}33%{content:'..'}66%{content:'...'}}`;

  const state = { endpoint: null, pass: null, history: [], busy: false };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
                  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage off */ } } };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  async function init() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    try { state.endpoint = (await (await fetch('county/chat-config.json?t=' + Date.now(), { cache: 'no-store' })).json()).endpoint || null; } catch (e) { /* no config */ }
    state.pass = store.get('sam-chat-pass');
    const btn = el('<button class="askbtn" aria-controls="askpanel">Ask Claude</button>');
    const panel = el(`<aside class="askpanel" id="askpanel" aria-label="Ask Claude about the results">
      <header><b>Ask Claude</b><span>answers from the results on this page</span><button aria-label="Close">×</button></header>
      <div class="asklog"></div>
      <form class="askform"><textarea placeholder="e.g. Is Ossoff on pace in metro Atlanta?"></textarea><button type="submit">Ask</button></form></aside>`);
    document.body.append(btn, panel);
    const log = panel.querySelector('.asklog'), ta = panel.querySelector('textarea'), send = panel.querySelector('.askform button');
    const open = v => { panel.classList.toggle('open', v); btn.style.display = v ? 'none' : ''; if (v) ta.focus(); };
    btn.onclick = () => open(true);
    panel.querySelector('header button').onclick = () => open(false);
    const add = (cls, html) => { const m = el(`<div class="askmsg ${cls}">${html}</div>`); log.appendChild(m); log.scrollTop = log.scrollHeight; return m; };

    const intro = () => {
      if (!state.endpoint) { add('e', 'The chat server isn\'t connected yet.'); return; }
      const h = add('askhint', `Claude sees the latest numbers on this page each time you ask: every race, every county against win pace, and the AI notes.${state.pass ? '' : '<br><br>Your first message should be the team passcode.'}`);
      if (state.pass) ['Where is the Dem underperforming win pace in Georgia?', 'What vote is still out in North Carolina, and does it help?', 'How are the SAM target districts looking?']
        .forEach(s => { const a = el(`<a>${esc(s)}</a>`); a.onclick = () => { ta.value = s; submit(); }; h.appendChild(a); });
    };
    intro();

    async function call(payload) {
      const r = await fetch(state.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ passcode: state.pass }, payload)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status });
      return j;
    }

    async function submit() {
      const text = ta.value.trim();
      if (!text || state.busy || !state.endpoint) return;
      ta.value = '';
      if (!state.pass) {   // first message is the passcode
        state.pass = text; add('u', '••••••');
        try { await call({ check: true }); store.set('sam-chat-pass', text); add('askhint', 'Passcode accepted. Ask away.'); log.innerHTML = ''; intro(); }
        catch (e) { state.pass = null; add('e', e.status === 401 ? 'That passcode didn\'t work. Try again.' : 'Couldn\'t reach the chat server: ' + esc(e.message)); }
        return;
      }
      add('u', esc(text));
      const wait = add('a', '<span class="dots">Reading the latest results</span>');
      state.busy = true; send.disabled = true;
      try {
        const ctx = (window.CTWidget ? await CTWidget.summary(text) : '') + (window.chatExtraContext ? '\n\n' + window.chatExtraContext() : '');
        const asOf = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' ET';
        const j = await call({ question: text, context: ctx, history: state.history, asOf });
        wait.innerHTML = esc(j.answer) + `<small>Claude · numbers as of ${asOf}</small>`;
        state.history.push({ role: 'user', text }, { role: 'assistant', text: j.answer });
        state.history = state.history.slice(-8);
      } catch (e) {
        wait.className = 'askmsg e';
        if (e.status === 401) { state.pass = null; store.set('sam-chat-pass', ''); wait.innerHTML = 'Passcode rejected. Send the team passcode again.'; }
        else wait.innerHTML = 'Couldn\'t get an answer: ' + esc(e.message);
      } finally { state.busy = false; send.disabled = false; log.scrollTop = log.scrollHeight; }
    }
    panel.querySelector('form').onsubmit = e => { e.preventDefault(); submit(); };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
