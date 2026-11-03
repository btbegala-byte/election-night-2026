// Nationwide balance of power: how many Senate and House seats each party has been called for, plus any live
// seat projection a major outlet has published. Runs in the background of the GitHub job, like ap_calls.mjs.
// Claude Code (with web search) does the lookup; this script throttles it, checks the reply and writes
// data/model/balance.json. The dashboard falls back to the pre-election forecast stored here until live numbers exist.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const CODE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = process.env.CT_ROOT || CODE;
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const FILE = path.join(ROOT, 'data/model/balance.json');
const now = process.env.CT_NOW ? Date.parse(process.env.CT_NOW) : Date.now();
const FIRST_CLOSE = Date.parse('2026-11-03T23:00:00Z');   // 6 pm ET: first polls close (parts of IN and KY)

// Fixed facts about the 2026 Senate: 35 seats up (33 regular + OH and FL specials). Seats not up: 34 that caucus
// with Democrats (incl. King and Sanders) and 31 Republicans. Republicans keep control at 50 with VP Vance.
const BASE = {
  senate: { total: 100, up: 35, holdover: { D: 34, R: 31 }, control: { D: 51, R: 50 }, note: 'Republicans keep control at 50 seats with the vice president\'s tie-breaking vote.' },
  house: { total: 435, up: 435, holdover: { D: 0, R: 0 }, control: { D: 218, R: 218 } },
  pre: {
    source_name: 'Decision Desk HQ final forecast', source_url: 'https://votes.decisiondeskhq.com/forecast/2026', as_of: '2026-11-03',
    senate: { D: 52, R: 48 }, house: { D: 241, R: 194 }
  }
};

function load() {
  const b = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {};
  return { ...BASE, called: b.called || { senate: { D: 0, R: 0, I: 0 }, house: { D: 0, R: 0, I: 0 } }, live: b.live || {}, sources: b.sources || [],
    updated_at: b.updated_at || null, checked_at: b.checked_at || null, log: b.log || [] };
}
function callClaude(prompt, timeoutMs = 360000) {
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
const int = x => Number.isInteger(+x) && +x >= 0 ? +x : null;

// Throttle: nothing before the first poll close; every 12 minutes once calls are coming in, every 20 before then.
function due(b) {
  if (now < FIRST_CLOSE) return false;
  if (process.argv.includes('--force')) return true;
  const last = b.checked_at ? Date.parse(b.checked_at) : 0;
  const anyCalled = ['senate', 'house'].some(c => (b.called[c].D + b.called[c].R + (b.called[c].I || 0)) > 0);
  return now - last >= (anyCalled ? 12 : 20) * 60000;
}

function checkChamber(name, x, prev, max) {
  if (!x) return { ok: false, why: `${name}: missing` };
  const v = { D: int(x.D), R: int(x.R), I: int(x.I || 0) };
  if (v.D == null || v.R == null || v.I == null) return { ok: false, why: `${name}: counts not whole numbers` };
  const tot = v.D + v.R + v.I, ptot = prev.D + prev.R + (prev.I || 0);
  if (tot > max) return { ok: false, why: `${name}: ${tot} called but only ${max} seats are up` };
  if (tot < ptot - 2) return { ok: false, why: `${name}: called total fell from ${ptot} to ${tot}` };   // a retraction or two is possible, a collapse is a bad read
  return { ok: true, v };
}

async function main() {
  const b = load();
  if (!due(b)) { console.log('balance: not due'); return; }
  const et = new Date(now).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const prompt = `It is election night, November 3, 2026, about ${et} ET. Use web search to find the CURRENT nationwide count of called races for the U.S. Senate and the U.S. House.

1. Called races. Count only races a major decision desk (AP, NBC News, CNN, ABC News, CBS News, Fox News, Decision Desk HQ) has projected a winner in TONIGHT. Prefer the AP tally (often carried by news sites' "balance of power" trackers); if you can't find AP's, use another desk's and say which. For the Senate, count only the 35 seats on the ballot this year, NOT the 65 holdover seats. Put independents (e.g. a non-party candidate who wins) under I. If nothing has been called yet, use 0.
2. Live projections. If a major outlet has published a LIVE election-night projection of final seat totals (for example the NBC News House estimate, Decision Desk HQ's live forecast, or the New York Times estimate), report it. Do not report pre-election forecasts here.

Previous reading (${b.checked_at || 'none'}): Senate called D ${b.called.senate.D}, R ${b.called.senate.R}, I ${b.called.senate.I || 0}; House called D ${b.called.house.D}, R ${b.called.house.R}.

Reply with ONLY this JSON, no other text:
{"senate_called": {"D": 0, "R": 0, "I": 0}, "house_called": {"D": 0, "R": 0, "I": 0},
 "called_source": {"name": "...", "url": "https://...", "as_of": "time stated on the page, if any"},
 "projections": [{"chamber": "house" or "senate", "D": 0, "R": 0, "plus_minus": null or number, "source_name": "...", "source_url": "https://...", "as_of": "..."}],
 "notes": "one short sentence on anything unusual (a retracted call, desks disagreeing), or empty"}
Every number must come from a page you actually found; include its URL. If you cannot find a figure, keep the previous reading for it and say so in notes.`;

  b.checked_at = new Date(now).toISOString();
  let r;
  try { r = parseJSON(await callClaude(prompt)); }
  catch (e) { b.log.push({ at: b.checked_at, error: String(e.message || e).slice(0, 200) }); b.log = b.log.slice(-60); fs.writeFileSync(FILE, JSON.stringify(b)); console.log('balance: error', e.message); return; }

  const src = r.called_source || {};
  const okSrc = src.url && /^https?:\/\//.test(src.url);
  const s = checkChamber('Senate', r.senate_called, b.called.senate, 35), h = checkChamber('House', r.house_called, b.called.house, 435);
  const entry = { at: b.checked_at, senate: r.senate_called, house: r.house_called, source: src.name || null, notes: r.notes || '' };
  if (okSrc && s.ok && h.ok) {
    const changed = JSON.stringify([s.v, h.v]) !== JSON.stringify([b.called.senate, b.called.house]);
    b.called = { senate: s.v, house: h.v, source_name: src.name || 'news report', source_url: src.url, as_of: src.as_of || null };
    if (changed) b.updated_at = b.checked_at;
  } else entry.rejected = [!okSrc && 'no source URL', !s.ok && s.why, !h.ok && h.why].filter(Boolean);

  for (const p of Array.isArray(r.projections) ? r.projections : []) {
    const ch = p.chamber === 'senate' ? 'senate' : p.chamber === 'house' ? 'house' : null;
    const D = int(p.D), R = int(p.R);
    if (!ch || D == null || R == null || !/^https?:\/\//.test(p.source_url || '')) continue;
    if (D + R > (ch === 'senate' ? 100 : 435) || D + R < (ch === 'senate' ? 95 : 400)) continue;   // must be a full-chamber total
    b.live[ch] = { D, R, plus_minus: p.plus_minus ?? null, source_name: p.source_name || 'news report', source_url: p.source_url, as_of: p.as_of || null, found_at: b.checked_at };
  }
  b.log.push(entry); b.log = b.log.slice(-60);
  fs.writeFileSync(FILE, JSON.stringify(b));
  console.log('balance:', JSON.stringify(entry));
}

main().catch(e => { console.error(e); process.exit(1); });
