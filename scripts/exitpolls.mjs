// Exit poll data from every outlet, in one place: Claude Code (with web search) reads the published exit polls
// (NBC, CNN, ABC, CBS: all the NEP / SSRS poll) and AP VoteCast (AP, Fox News, WSJ), nationally and in SAM's six
// states, and returns the crosstab numbers. This script checks them, merges them with earlier pulls and writes
// data/model/exitpolls_data.json. The dashboard draws its own charts from these numbers and links each outlet's page.
// Runs in the background of the GitHub job (throttles itself to every 15 min) or on demand with --force.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const CODE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = process.env.CT_ROOT || CODE;
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const FILE = path.join(ROOT, 'data/model/exitpolls_data.json');
const now = process.env.CT_NOW ? Date.parse(process.env.CT_NOW) : Date.now();
const FIRST = Date.parse('2026-11-03T21:30:00Z');
const SCOPES = ['National', 'GA', 'NC', 'OH', 'MI', 'TX', 'IA'];
export const TOPICS = ['Age by gender', 'Vote by gender', 'Vote by age', 'Race and ethnicity', 'Education', 'Party ID', 'Ideology',
  'Trump approval', 'Most important issue', 'Economy', 'Direction of the country', 'Other'];

function callClaude(prompt, timeoutMs = 540000) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', MODEL, '--output-format', 'text', '--allowedTools', 'WebSearch', 'WebFetch'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 400)}`)); });
    p.stdin.end(prompt);
  });
}
function parseJSON(txt) { const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a < 0 || b < 0) throw new Error('no json in reply'); return JSON.parse(txt.slice(a, b + 1)); }
const pct = x => { if (x == null || x === '') return null; const v = Number(x); return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null; };
const str = (x, n) => typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : null;
const url = u => typeof u === 'string' && /^https?:\/\//.test(u) ? u.slice(0, 400) : null;
const topicOf = t => TOPICS.find(x => x.toLowerCase() === String(t || '').toLowerCase()) || 'Other';
const scopeOf = s => { s = String(s || '').trim(); const m = SCOPES.find(x => x.toLowerCase() === s.toLowerCase()); if (m) return m;
  const names = { georgia: 'GA', 'north carolina': 'NC', ohio: 'OH', michigan: 'MI', texas: 'TX', iowa: 'IA', national: 'National', us: 'National', 'u.s.': 'National' };
  return names[s.toLowerCase()] || null; };

// one table from one outlet; null unless it checks out
function table(x) {
  if (!x || typeof x !== 'object') return null;
  const scope = scopeOf(x.scope), outlet = str(x.outlet, 40), u = url(x.url);
  if (!scope || !outlet || !u || !Array.isArray(x.rows)) return null;
  const rows = x.rows.map(r => {
    const group = str(r && r.group, 60); if (!group) return null;
    const D = pct(r.D), R = pct(r.R), share = pct(r.share);
    const vote = D != null && R != null && D + R <= 100.5 && D + R >= 50;
    if (!vote && share == null) return null;
    return { group, share, ...(vote ? { D, R } : {}) };
  }).filter(Boolean).slice(0, 14);
  if (rows.length < 2) return null;
  return { scope, topic: topicOf(x.topic), question: str(x.question, 120) || topicOf(x.topic), outlet, survey: str(x.survey, 60),
    race: str(x.race, 40), url: u, rows };
}

function prompt(et, scopes) {
  const where = scopes.includes('National') ? 'NATIONALLY (U.S. House vote)' : `in each of these states (for its top race: Senate, or governor if no Senate race): ${scopes.map(s => ({ GA: 'Georgia', NC: 'North Carolina', OH: 'Ohio', MI: 'Michigan', TX: 'Texas', IA: 'Iowa' })[s]).join(', ')}`;
  return `It is election night, November 3, 2026, about ${et} ET. Use web search (and fetch the pages) to collect tonight's published EXIT POLL numbers ${where}, from every outlet that has posted them: NBC News, CNN, ABC News and CBS News (the NEP / SSRS exit poll), and AP VoteCast (AP News, Fox News, WSJ). Use only 2026 numbers from tonight, never older surveys or pre-election polls.

Collect these tables when published (one entry per outlet per table; if two outlets publish the same NEP table, include both):
${TOPICS.filter(t => t !== 'Other').map(t => '- ' + t).join('\n')}
(and any other tables that matter for young voters or men, as "Other")

For each row give the group, its share of the electorate (%), and the Democratic and Republican vote % when the table is a vote-choice crosstab. For opinion tables (approval, top issue, economy, direction) give each answer as a row with only its share (%), and its D/R vote split if the table shows it. Copy numbers exactly as shown; never estimate or compute. Every entry needs the URL of the page showing it.

Reply with ONLY this JSON:
{"tables": [{"scope": "National" or a state code like "GA", "topic": one of the topic names above, "question": "the table's title as shown", "outlet": "CNN", "survey": "NEP exit poll" or "AP VoteCast", "race": "U.S. House", "url": "https://...", "rows": [{"group": "Men 18-29", "share": 6, "D": 45, "R": 52}]}],
 "links": [{"outlet": "CNN", "title": "short page title", "url": "https://...", "scope": "National"}]}
If nothing is published yet, return {"tables": [], "links": []}.`;
}

async function main() {
  const force = process.argv.includes('--force');
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : { tables: [], links: [], log: [] };
  if (now < FIRST && !force) { console.log('exitpolls: too early'); return; }
  const last = prev.checked_at ? Date.parse(prev.checked_at) : 0;
  if (now - last < 15 * 60000 && !force) { console.log('exitpolls: not due'); return; }
  const et = new Date(now).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const out = { ...prev, checked_at: new Date(now).toISOString() };

  // national and the six states in parallel, so one slow search doesn't hold up the other
  const groups = [['National'], ['GA', 'NC', 'OH'], ['MI', 'TX', 'IA']];
  const replies = await Promise.allSettled(groups.map(g => callClaude(prompt(et, g)).then(parseJSON)));
  const fresh = [], links = [];
  replies.forEach((r, i) => {
    if (r.status !== 'fulfilled') { console.log('exitpolls: group', groups[i].join('/'), 'failed:', String(r.reason && r.reason.message || r.reason).slice(0, 200)); return; }
    (r.value.tables || []).map(table).filter(Boolean).forEach(t => fresh.push(t));
    (r.value.links || []).forEach(l => { const u = url(l && l.url), o = str(l && l.outlet, 40); if (u && o) links.push({ outlet: o, title: str(l.title, 100) || o + ' exit poll', url: u, scope: scopeOf(l.scope) || 'National' }); });
  });
  // newest reading wins per (place, topic, outlet, question); keep earlier tables the new pull didn't return
  const key = t => [t.scope, t.topic, t.outlet, t.question.toLowerCase()].join('|');
  const byKey = new Map((prev.tables || []).map(t => [key(t), t]));
  fresh.forEach(t => byKey.set(key(t), { ...t, at: out.checked_at }));
  out.tables = [...byKey.values()];
  const lk = new Map((prev.links || []).map(l => [l.url, l]));
  links.concat(fresh.map(t => ({ outlet: t.outlet, title: `${t.outlet} exit poll${t.scope === 'National' ? '' : ' · ' + t.scope}`, url: t.url, scope: t.scope })))
    .forEach(l => { if (!lk.has(l.url)) lk.set(l.url, l); });
  out.links = [...lk.values()].slice(0, 40);
  if (fresh.length) out.updated_at = out.checked_at;
  out.log = (prev.log || []).concat({ at: out.checked_at, tables: fresh.length }).slice(-40);
  fs.writeFileSync(FILE, JSON.stringify(out));
  console.log('exitpolls: tables this pull', fresh.length, '· total', out.tables.length);
}
main().catch(e => { console.error(e); process.exit(1); });
