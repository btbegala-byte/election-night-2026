// Cloudflare Worker: "Ask Claude" proxy for the SAM election-night dashboard.
// Secrets (Worker > Settings > Variables and Secrets): ANTHROPIC_API_KEY, CHAT_PASSCODE
// The browser sends the question plus a text snapshot of the results it's showing; this Worker
// checks the passcode, calls Claude (with web search for background), and returns the answer.
// The API key never reaches the browser.
const MODEL = 'claude-sonnet-5-5';
const ALLOWED_ORIGINS = ['https://btbegala-byte.github.io', 'http://localhost:8767'];
const MAX_CONTEXT_CHARS = 180000;
const MAX_QUESTION_CHARS = 1500;
const SYSTEM = `You answer questions from a small Democratic-aligned team watching election night returns on their dashboard. Be genuinely useful: give a real answer every time.
Sources, in this order:
1. The RESULTS SNAPSHOT in the message: tonight's unofficial civicAPI counts, % reporting, race calls from AP and the network decision desks, the team's county win-pace model, alerts and AI notes. This is the only source for tonight's numbers and calls.
2. The "Pre-election background" section of the snapshot: final forecasts, polling averages and context for each race.
3. Your own general knowledge of the candidates, states and political landscape.
4. Web search, for background the snapshot doesn't have (a candidate's record, what an outlet is reporting tonight, exit poll commentary, how a county usually reports). Name the outlet. Don't search for things the snapshot already answers. If a reputable outlet reports a race call the snapshot doesn't show yet, you may mention it with the source.
Label background as background, and never let it override tonight's counts or calls. Never invent numbers, calls or quotes.
Election-night analysis of the returns is the main job. Definitions: "win pace" is the two-party Democratic share a county must hit for the Democrat to win the state or district. "Net vs. pace" is how many net votes a county is running ahead (+) or behind (-) that pace at the current count. The projection is the team's own model, not a race call; say so if you cite it. Early and mail votes are counted first in GA, NC, MI and OH and lean Democratic.
Style: lead with the answer, then the numbers that back it up. Short paragraphs or a tight list; use **bold** sparingly and "- " for list items. Direct, peer-to-peer, no cheerleading, no hedging filler, no em dashes, no "it's not X, it's Y" constructions. Note the snapshot time if timing matters.`;
function cors(origin) {
const ok = ALLOWED_ORIGINS.includes(origin);
return {
'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
'Access-Control-Allow-Methods': 'POST, OPTIONS',
'Access-Control-Allow-Headers': 'Content-Type',
'Vary': 'Origin',
};
}
const json = (obj, status, origin) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
async function ask(env, messages, useSearch) {
const body = { model: MODEL, max_tokens: 8000, system: SYSTEM, messages };
if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
const r = await fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
body: JSON.stringify(body),
});
const data = await r.json().catch(() => ({}));
return { r, data };
}
export default {
async fetch(req, env) {
const origin = req.headers.get('Origin') || '';
if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, origin);
let body;
try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
if (!env.CHAT_PASSCODE || body.passcode !== env.CHAT_PASSCODE) return json({ error: 'wrong passcode' }, 401, origin);
if (body.check) return json({ ok: true }, 200, origin);
const q = String(body.question || '').slice(0, MAX_QUESTION_CHARS).trim();
if (!q) return json({ error: 'empty question' }, 400, origin);
const ctx = String(body.context || '').slice(0, MAX_CONTEXT_CHARS);
const hist = Array.isArray(body.history) ? body.history.slice(-6) : [];
const messages = [];
for (const h of hist) {
if (h && (h.role === 'user' || h.role === 'assistant') && h.text) messages.push({ role: h.role, content: String(h.text).slice(0, 6000) });
}
while (messages.length && messages[0].role !== 'user') messages.shift();
messages.push({ role: 'user', content: `RESULTS SNAPSHOT (as of ${body.asOf || 'unknown'}):\n${ctx}\n\nQUESTION: ${q}` });
const clean = [];
for (const m of messages) { if (clean.length && clean[clean.length - 1].role === m.role) clean[clean.length - 1].content += '\n\n' + m.content; else clean.push(m); }
// web search on; if the API rejects the tool for any reason, answer without it
let { r, data } = await ask(env, clean, true);
let searched = true;
if (!r.ok && r.status === 400) { ({ r, data } = await ask(env, clean, false)); searched = false; }
// a long search can pause the turn; let it continue (up to twice)
let convo = clean.slice(), all = (data.content || []).slice();
for (let i = 0; r.ok && data.stop_reason === 'pause_turn' && i < 2; i++) {
convo = convo.concat([{ role: 'assistant', content: data.content }]);
({ r, data } = await ask(env, convo, true));
all = all.concat(data.content || []);
}
if (!r.ok) return json({ error: (data.error && data.error.message) || `Claude API error ${r.status}` }, 502, origin);
const text = all.filter(b => b.type === 'text').map(b => b.text).join('').trim();
const searches = all.filter(b => b.type === 'server_tool_use').length;
return json({ answer: text || '(no answer)', stop_reason: data.stop_reason || null, types: all.map(b => b.type), searched, searches }, 200, origin);
},
};
