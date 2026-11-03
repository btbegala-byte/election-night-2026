/* "Ask Claude" drawer for the results dashboard. Talks to the Cloudflare Worker in worker/chat-worker.js.
   Config: county/chat-config.json -> {"endpoint": "https://<worker>.workers.dev"} */
(function () {
  const CSS = `
  .askbtn{position:fixed;right:0;top:50%;transform:translateY(-50%) rotate(-90deg);transform-origin:right bottom;z-index:40;background:#17365D;color:#e8edf2;border:1px solid #4F81BD;border-bottom:0;border-radius:8px 8px 0 0;padding:7px 14px;font:600 13px Calibri,system-ui,sans-serif;cursor:pointer;letter-spacing:.3px}
  .askbtn:hover{background:#1f4677}
  .askpanel{position:fixed;top:0;right:0;height:100vh;height:100dvh;width:min(420px,100vw);background:#141b22;border-left:1px solid #2a3542;z-index:45;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s ease;box-shadow:-8px 0 24px rgba(0,0,0,.35);visibility:hidden}
  .askpanel.open{transform:none;visibility:visible}
  .askpanel header{position:static;display:flex;align-items:center;gap:8px;padding:12px 14px;padding-top:max(12px,env(safe-area-inset-top));border-bottom:1px solid #2a3542;background:#171e26;backdrop-filter:none}
  .askpanel header .ttl{display:flex;flex-direction:column;line-height:1.2}
  .askpanel header b{font-size:16px}
  .askpanel header span{color:#8a99a8;font-size:12px}
  .askpanel header button{margin-left:auto;background:transparent;border:0;color:#c3ccd5;font-size:26px;line-height:1;cursor:pointer;padding:4px 8px;min-width:44px;min-height:44px}
  .asklog{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
  .askmsg{font-size:15px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
  .askmsg.u{align-self:flex-end;background:#17365D;border:1px solid #2c5288;padding:8px 11px;border-radius:12px 12px 2px 12px;max-width:85%}
  .askmsg.a{background:#1d2630;border:1px solid #2a3542;padding:9px 12px;border-radius:12px 12px 12px 2px}
  .askmsg.a small,.askmsg.e small{display:block;color:#8a99a8;font-size:11px;margin-top:4px}
  .askmsg.e{color:#f1b0b0;font-size:14px}
  .askmsg.a{white-space:normal}.askmsg.a p{margin:0 0 7px}.askmsg.a p:last-of-type{margin-bottom:2px}.askmsg.a ul{margin:0 0 7px;padding-left:20px}.askmsg.a li{margin:2px 0}
  .askmsg .retry{color:#8fb6f0;cursor:pointer;text-decoration:underline}
  .askhint{color:#8a99a8;font-size:13.5px;line-height:1.45}
  .askhint a{color:#86b6ef;cursor:pointer;display:block;margin-top:6px;padding:9px 11px;border:1px solid #2a3542;border-radius:10px;text-decoration:none;background:#171e26}
  .askform{display:flex;gap:8px;padding:10px 12px;padding-bottom:max(10px,env(safe-area-inset-bottom));border-top:1px solid #2a3542;background:#171e26}
  .askform textarea{flex:1;resize:none;height:58px;background:#0f1419;color:#e8edf2;border:1px solid #2a3542;border-radius:10px;padding:9px 10px;font:16px Calibri,system-ui,sans-serif}
  .askform button,.asklock button{background:#4F81BD;color:#fff;border:0;border-radius:10px;padding:0 16px;font:600 15px Calibri,system-ui,sans-serif;cursor:pointer;min-height:44px}
  .askform button:disabled{opacity:.5;cursor:default}
  .asklock{flex:1;display:flex;flex-direction:column;justify-content:center;padding:24px 22px 40px;gap:12px}
  .asklock .ic{width:44px;height:44px;border-radius:12px;background:#17365D;display:flex;align-items:center;justify-content:center;font-size:22px}
  .askpanel .asklock h3{margin:4px 0 0;font-size:21px;text-transform:none;letter-spacing:0;color:#e8edf2;font-weight:700}
  .asklock p{margin:0;color:#aab7c4;font-size:14.5px;line-height:1.45}
  .asklock form{display:flex;flex-direction:column;gap:10px;margin-top:8px}
  .asklock input{background:#0f1419;color:#e8edf2;border:1px solid #3a4a5c;border-radius:10px;padding:12px;font:17px Calibri,system-ui,sans-serif}
  .asklock input:focus{outline:2px solid #4F81BD;border-color:#4F81BD}
  .asklock .err{color:#f1b0b0;font-size:14px;min-height:18px}
  .dots::after{content:'…';animation:askd 1s steps(3) infinite}
  @keyframes askd{0%{content:'.'}33%{content:'..'}66%{content:'...'}}
  @media (max-width:700px){
    .askbtn{top:auto;bottom:max(16px,env(safe-area-inset-bottom));right:16px;transform:none;border:1px solid #4F81BD;border-radius:999px;padding:12px 18px;font-size:15px;box-shadow:0 6px 18px rgba(0,0,0,.45)}
    .askpanel{width:100vw;border-left:0;box-shadow:none}
    body.ask-open{overflow:hidden}
  }`;

  const state = { endpoint: null, pass: null, history: [], busy: false };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
                  set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* storage off */ } } };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // light markdown for answers: **bold**, "- " bullet lines, paragraphs
  const md = s => {
    const lines = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
    let out = '', inList = false;
    for (const ln of lines) {
      const m = ln.match(/^\s*[-*•]\s+(.*)$/);
      if (m) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${m[1]}</li>`; continue; }
      if (inList) { out += '</ul>'; inList = false; }
      out += ln.trim() ? `<p>${ln}</p>` : '';
    }
    return out + (inList ? '</ul>' : '');
  };
  const el = html => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };

  async function init() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    try { state.endpoint = (await (await fetch('county/chat-config.json?t=' + Date.now(), { cache: 'no-store' })).json()).endpoint || null; } catch (e) { /* no config */ }
    state.pass = store.get('sam-chat-pass');

    const btn = el('<button class="askbtn" aria-controls="askpanel">Ask Claude</button>');
    const panel = el(`<aside class="askpanel" id="askpanel" aria-label="Ask Claude about the results" aria-hidden="true">
      <header><div class="ttl"><b>Ask Claude</b><span>Answers from the results on this page</span></div><button aria-label="Close chat">×</button></header>
      <div class="asklock">
        <div class="ic">🔒</div>
        <h3>Enter the team passcode</h3>
        <p>The chat is for the SAM team. Enter the passcode you were given to start asking questions. You only have to do this once on this device.</p>
        <form><input type="password" autocomplete="current-password" placeholder="Team passcode" aria-label="Team passcode" enterkeyhint="go"><button type="submit">Unlock chat</button><div class="err" role="alert"></div></form>
      </div>
      <div class="asklog" style="display:none"></div>
      <form class="askform" style="display:none"><textarea placeholder="Ask about any race or county…" aria-label="Your question" enterkeyhint="send"></textarea><button type="submit">Ask</button></form></aside>`);
    document.body.append(btn, panel);
    const lock = panel.querySelector('.asklock'), pin = lock.querySelector('input'), perr = lock.querySelector('.err'), pbtn = lock.querySelector('button');
    const log = panel.querySelector('.asklog'), form = panel.querySelector('.askform'), ta = form.querySelector('textarea'), send = form.querySelector('button');
    const mobile = () => window.matchMedia('(max-width:700px)').matches;

    function showLock(msg) {
      lock.style.display = ''; log.style.display = 'none'; form.style.display = 'none';
      perr.textContent = msg || ''; pin.value = '';
      if (panel.classList.contains('open')) setTimeout(() => pin.focus(), 50);
    }
    function showChat() {
      lock.style.display = 'none'; log.style.display = ''; form.style.display = '';
      if (!log.children.length) intro();
      if (panel.classList.contains('open') && !mobile()) setTimeout(() => ta.focus(), 50);
    }
    const open = v => {
      panel.classList.toggle('open', v); panel.setAttribute('aria-hidden', v ? 'false' : 'true');
      btn.style.display = v ? 'none' : ''; document.body.classList.toggle('ask-open', v);
      if (v) (state.pass ? showChat : showLock)();
    };
    btn.onclick = () => open(true);
    panel.querySelector('header button').onclick = () => open(false);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('open')) open(false); });

    const add = (cls, html) => { const m = el(`<div class="askmsg ${cls}">${html}</div>`); log.appendChild(m); log.scrollTop = log.scrollHeight; return m; };
    function intro() {
      if (!state.endpoint) { add('e', 'The chat server isn\'t connected yet.'); return; }
      const h = add('askhint', 'Claude sees the latest numbers on this page each time you ask: every race, every county against win pace, and the AI notes. Try:');
      ['Where is the Dem underperforming win pace in Georgia?', 'What vote is still out in North Carolina, and does it help?', 'How are the SAM target districts looking?']
        .forEach(s => { const a = el(`<a>${esc(s)}</a>`); a.onclick = () => { ta.value = s; submit(); }; h.appendChild(a); });
    }

    async function call(payload, pass) {
      const r = await fetch(state.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ passcode: pass || state.pass }, payload)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status });
      return j;
    }

    lock.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const code = pin.value.trim();
      if (!code) { perr.textContent = 'Type the passcode first.'; return; }
      if (!state.endpoint) { perr.textContent = 'The chat server isn\'t connected yet.'; return; }
      pbtn.disabled = true; pbtn.textContent = 'Checking…'; perr.textContent = '';
      try { await call({ check: true }, code); state.pass = code; store.set('sam-chat-pass', code); showChat(); }
      catch (err) { perr.textContent = err.status === 401 ? 'That passcode didn\'t work. Check it and try again.' : 'Couldn\'t reach the chat server. Try again in a moment.'; }
      finally { pbtn.disabled = false; pbtn.textContent = 'Unlock chat'; }
    };

    async function submit() {
      const text = ta.value.trim();
      if (!text || state.busy || !state.endpoint) return;
      ta.value = ''; if (mobile()) ta.blur();
      add('u', esc(text));
      const wait = add('a', '<span class="dots">Reading the latest results</span>');
      state.busy = true; send.disabled = true;
      try {
        // make sure the races the question needs are loaded (the page only fetches what's on screen)
        if (window.chatEnsureData) { try { await window.chatEnsureData(text, msg => { wait.innerHTML = `<span class="dots">${esc(msg)}</span>`; }); } catch (e) { /* answer with what we have */ } }
        const ctx = (window.CTWidget ? await CTWidget.summary(text) : '') + (window.chatExtraContext ? '\n\n' + window.chatExtraContext() : '');
        const asOf = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' ET';
        const empty = a => !a || !String(a).trim() || String(a).trim() === '(no answer)';
        const payload = { question: text, context: ctx, history: state.history, asOf };
        let j = await call(payload);
        // Claude occasionally returns an empty reply; ask once more before giving up
        if (empty(j.answer)) { wait.innerHTML = '<span class="dots">Still working on it</span>'; j = await call(payload); }
        if (empty(j.answer)) {
          wait.className = 'askmsg e';
          wait.innerHTML = 'Claude didn\'t return an answer that time. <a class="retry">Try again</a>';
          wait.querySelector('.retry').onclick = () => { wait.remove(); ta.value = text; submit(); };
          return;
        }
        wait.innerHTML = md(j.answer) + `<small>Claude · numbers as of ${asOf}</small>`;
        state.history.push({ role: 'user', text }, { role: 'assistant', text: j.answer });
        state.history = state.history.slice(-8);
      } catch (e) {
        if (e.status === 401) { state.pass = null; store.set('sam-chat-pass', null); wait.remove(); showLock('The passcode changed or expired. Enter the current one.'); }
        else { wait.className = 'askmsg e'; wait.innerHTML = 'Couldn\'t get an answer: ' + esc(e.message); }
      } finally { state.busy = false; send.disabled = false; log.scrollTop = log.scrollHeight; }
    }
    form.onsubmit = e => { e.preventDefault(); submit(); };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !mobile()) { e.preventDefault(); submit(); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
