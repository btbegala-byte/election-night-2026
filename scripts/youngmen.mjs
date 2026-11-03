// Young men in the exit polls: how men 18-29 voted tonight (nationally and in SAM's six states), next to all voters
// and the 2024 benchmark. Claude Code (with web search) reads published exit polls (CNN/NEP Edison, NBC, ABC, CBS)
// and AP VoteCast (AP, Fox); this script throttles it, checks the numbers and writes data/model/youngmen.json.
// Runs in the background of the GitHub job, like balance.mjs.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const CODE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = process.env.CT_ROOT || CODE;
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const FILE = path.join(ROOT, 'data/model/youngmen.json');
const now = process.env.CT_NOW ? Date.parse(process.env.CT_NOW) : Date.now();
const FIRST = Date.parse('2026-11-04T00:00:00Z');      // 7 pm ET: first exit poll numbers post when GA polls close
const STATES = ['GA', 'NC', 'OH', 'MI', 'TX', 'IA'];

function callClaude(prompt, timeoutMs = 420000) {
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
const pct = x => { const v = Number(x); return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null; };
const url = u => typeof u === 'string' && /^https?:\/\//.test(u) ? u : null;
// one D/R pair with its source; null unless it checks out
function pair(x) {
  if (!x || typeof x !== 'object') return null;
  const D = pct(x.D), R = pct(x.R);
  if (D == null || R == null || D + R > 100.5 || D + R < 60) return null;
  return { D, R, race: typeof x.race === 'string' ? x.race.slice(0, 40) : null, source_name: typeof x.source_name === 'string' ? x.source_name.slice(0, 60) : null, source_url: url(x.source_url) };
}
function block(x) {
  if (!x || typeof x !== 'object') return null;
  const o = { men1829: pair(x.men_18_29), all: pair(x.all_voters), voters1829: pair(x.voters_18_29), men1829_2024: pair(x.men_18_29_2024) };
  if (o.men1829 && !o.men1829.source_url) o.men1829 = null;
  return Object.values(o).some(Boolean) ? o : null;
}

async function main() {
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : { national: null, states: {}, notes: [], log: [] };
  if (now < FIRST && !process.argv.includes('--force')) { console.log('youngmen: before 7 pm ET'); return; }
  const last = prev.checked_at ? Date.parse(prev.checked_at) : 0;
  if (now - last < 20 * 60000 && !process.argv.includes('--force')) { console.log('youngmen: not due'); return; }
  const et = new Date(now).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const prompt = `It is election night, November 3, 2026, about ${et} ET. Use web search to find how YOUNG MEN (men ages 18-29) voted today, from published exit polls (CNN / NEP-Edison, NBC, ABC, CBS) or AP VoteCast (AP News, Fox News). Look nationally (U.S. House vote) and in each of these states for its top race (Senate, or governor if no Senate race): Georgia, North Carolina, Ohio, Michigan, Texas, Iowa.

For each place report, when published: men 18-29 (Dem % / Rep %), all voters (Dem % / Rep %) from the same survey, voters 18-29 of both sexes, and the 2024 benchmark for men 18-29 (presidential vote, same survey family if possible). Many state exit polls publish an "age by gender" table with a "Men 18-29" row; use it. Do not estimate or compute numbers yourself; only report figures shown on a page you found, with its URL. Leave anything you cannot find as null.

Reply with ONLY this JSON:
{"national": {"men_18_29": {"D": 0, "R": 0, "race": "U.S. House", "source_name": "...", "source_url": "https://..."}, "all_voters": {...same shape...}, "voters_18_29": {...}, "men_18_29_2024": {...}},
 "states": {"GA": {same four keys}, "NC": {...}, "OH": {...}, "MI": {...}, "TX": {...}, "IA": {...}},
 "notes": ["up to 3 short factual sentences IN YOUR OWN WORDS about young men in tonight's exit polls, each tied to a source you found"]}`;

  const out = { ...prev, checked_at: new Date(now).toISOString() };
  let r;
  try { r = parseJSON(await callClaude(prompt)); }
  catch (e) { out.log = (prev.log || []).concat({ at: out.checked_at, error: String(e.message || e).slice(0, 200) }).slice(-40); fs.writeFileSync(FILE, JSON.stringify(out)); console.log('youngmen: error', e.message); return; }

  // keep the last good reading for any place the new reply leaves empty
  const nat = block(r.national); if (nat) out.national = { ...(prev.national || {}), ...Object.fromEntries(Object.entries(nat).filter(([, v]) => v)) };
  out.states = { ...(prev.states || {}) };
  for (const st of STATES) { const b = block((r.states || {})[st]); if (b) out.states[st] = { ...(prev.states || {})[st], ...Object.fromEntries(Object.entries(b).filter(([, v]) => v)) }; }
  if (Array.isArray(r.notes)) { const n = r.notes.filter(x => typeof x === 'string' && x.length > 10).map(x => x.slice(0, 260)).slice(0, 3); if (n.length) out.notes = n; }
  const found = (nat && nat.men1829 ? 1 : 0) + STATES.filter(st => out.states[st] && out.states[st].men1829).length;
  if (nat || STATES.some(st => (r.states || {})[st])) out.updated_at = out.checked_at;
  out.log = (prev.log || []).concat({ at: out.checked_at, found }).slice(-40);
  fs.writeFileSync(FILE, JSON.stringify(out));
  console.log('youngmen: places with men 18-29 figures:', found);
}
main().catch(e => { console.error(e); process.exit(1); });
