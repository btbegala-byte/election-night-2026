// AP race-call checker. Runs alongside county_blurbs.mjs in the GitHub job.
// Reads the civicAPI pull county_blurbs.mjs just made (/tmp/ct_raw.json) so it never refetches,
// and asks Claude Code (with web search) whether AP has called the races that are due for a check.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const CODE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = process.env.CT_ROOT || CODE;
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const DRY = process.argv.includes('--dry');
const RACES = JSON.parse(fs.readFileSync(path.join(ROOT, 'races.json'))).races || [];
const RAW = JSON.parse(fs.readFileSync(process.env.CT_RAW_IN || '/tmp/ct_raw.json'));
const STATES = { GA: 'Georgia', NC: 'North Carolina', OH: 'Ohio', MI: 'Michigan', TX: 'Texas', IA: 'Iowa' };
const abbr = p => { const x = String(p || '').toLowerCase(); return x.startsWith('dem') ? 'D' : x.startsWith('rep') ? 'R' : x.startsWith('lib') ? 'L' : x.startsWith('green') ? 'G' : x.startsWith('ind') ? 'I' : (p || '?'); };
function callClaude(prompt, extraArgs = [], timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', MODEL, '--output-format', 'text', ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 400)}`)); });
    p.stdin.end(prompt);
  });
}
function parseJSON(txt) { const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a < 0 || b < 0) throw new Error('no json in reply'); return JSON.parse(txt.slice(a, b + 1)); }

// civicAPI's own race calls are ignored. Claude (with web search) checks whether the Associated Press has
// called a race, but only for races where a call is plausible right now (see dueReasons). One Claude call per
// cycle, at most AP_BATCH races. Results: data/model/ap_calls.json (calls + per-race check state + log).
const AP_FILE = path.join(ROOT, 'data/model/ap_calls.json');
const AP_BATCH = 8;
// AP never calls before the LAST poll close covering a race (ET -> UTC on Nov 3/4)
const FINAL_CLOSE = { GA: '2026-11-04T00:00:00Z', NC: '2026-11-04T00:30:00Z', OH: '2026-11-04T00:30:00Z',
  MI: '2026-11-04T02:00:00Z', IA: '2026-11-04T02:00:00Z', TX: '2026-11-04T02:00:00Z' };   // MI/TX statewide: western U.P. / El Paso close 9 pm ET
const TX_EARLY_CLOSE = '2026-11-04T01:00:00Z';   // TX races wholly in Central time close at 8 pm ET
const TX_8PM = new Set(['US House 9', 'US House 15', 'US House 28', 'US House 34', 'US House 35']);
const ap = fs.existsSync(AP_FILE) ? JSON.parse(fs.readFileSync(AP_FILE)) : { calls: {}, checks: {}, log: [] };

function closeFor(r) {
  if (r.state === 'TX' && (TX_8PM.has(r.name) || r.group === 'stsen' || r.group === 'sthouse')) return Date.parse(TX_EARLY_CLOSE);
  return Date.parse(FINAL_CLOSE[r.state]);
}
function raceSnap(r) {
  const d = RAW[r.id]; if (!d || !d.candidates) return null;
  const cs = d.candidates.map(c => ({ name: c.name, party: abbr(c.party), votes: +c.votes || 0 })).sort((a, b) => b.votes - a.votes);
  const tot = cs.reduce((a, c) => a + c.votes, 0);
  const margin = tot && cs.length > 1 ? (cs[0].votes - cs[1].votes) / tot : 0;
  return { cs, tot, pr: +d.percent_reporting || 0, margin };
}
function dueReasons(r, now) {
  if (ap.calls[r.id]) return null;                       // already called
  const close = closeFor(r);
  if (!(now >= close)) return null;                      // AP never calls before the final poll close
  const sn = raceSnap(r); if (!sn) return null;
  const ck = ap.checks[r.id];
  const mins = ck ? (now - Date.parse(ck.at)) / 60000 : Infinity;
  if (!ck) return 'first check after polls closed (AP calls clear races at poll close)';
  if (mins < 8) return null;                             // never more often than every ~8 minutes
  const jumpVotes = sn.tot - (ck.votes || 0);
  const jumpPr = sn.pr - (ck.pr || 0);
  if (sn.tot > 0 && (jumpPr >= 10 || jumpVotes >= Math.max(15000, 0.15 * (ck.votes || 0)))) return `big vote drop since last check (+${jumpVotes} votes, +${jumpPr.toFixed(0)} pts reporting)`;
  if (sn.tot > 0 && Math.abs(sn.margin) >= 0.10 && sn.pr >= 20 && mins >= 15) return `clear margin (${(sn.margin * 100).toFixed(1)} pts) with ${sn.pr.toFixed(0)}% reporting`;
  if (sn.pr >= 95 && mins >= 15) return 'nearly all vote counted';
  if (mins >= 40) return 'periodic recheck (40 min)';
  return null;
}
const PRIORITY = r => (/US Senate|Governor$/.test(r.name) && !/Lieutenant/.test(r.name) ? 0 : r.target ? 1 : /US House/.test(r.name) ? 2 : 3);

async function apCalls() {
  const now = process.env.CT_NOW ? Date.parse(process.env.CT_NOW) : Date.now();
  const due = [];
  for (const r of RACES) {
    // statewide down-ballot judicial/measure races are low value; check them only once the race is mostly counted
    const why = dueReasons(r, now);
    if (!why) continue;
    if (PRIORITY(r) === 3 && !/State (Senate|House)/.test(r.name) && (raceSnap(r) || {}).pr < 60 && ap.checks[r.id]) continue;
    due.push({ r, why });
  }
  if (!due.length) { console.log('AP: nothing due'); return; }
  due.sort((a, b) => PRIORITY(a.r) - PRIORITY(b.r) || (Date.parse((ap.checks[a.r.id] || {}).at || 0) - Date.parse((ap.checks[b.r.id] || {}).at || 0)));
  const batch = due.slice(0, AP_BATCH);
  const list = batch.map(({ r, why }) => {
    const sn = raceSnap(r);
    return `- id ${r.id}: ${STATES[r.state] || r.state} ${r.label || r.name} (2026 general, Nov 3). Candidates: ${sn.cs.slice(0, 4).map(c => `${c.name} (${c.party})`).join(', ')}. ` +
      `Unofficial count so far: ${sn.tot ? sn.cs.slice(0, 2).map(c => `${c.name} ${c.votes}`).join(' vs ') + `, ${sn.pr}% reporting` : 'no votes yet'}. Why checking now: ${why}.`;
  }).join('\n');
  const prompt = `Check whether The Associated Press (AP) has called (declared a winner in) each race below in the November 3, 2026 U.S. general election. Use web search; look for AP's own race-call reports (apnews.com) or news reports that explicitly attribute the call to the Associated Press ("AP declared", "according to The Associated Press", "AP race call").
Rules:
- Report called=true ONLY if a source explicitly says the AP called or declared the race. Calls by other decision desks (CNN, NBC, ABC, CBS, Fox, DDHQ, NYT) do not count. Candidate victory claims and concessions do not count. Leads do not count.
- The winner must be one of the listed candidates; use the name as listed.
- If you can't find an explicit AP call, report called=false. Being wrong in the false direction is fine; a false positive is not.
- Include the source URL and the time of the call if the source gives it (e.g. "9:14 PM ET").
Races:
${list}

Return ONLY a JSON object, no prose: {"<id>": {"called": true|false, "winner": "<name or null>", "called_at": "<time or null>", "source_url": "<url or null>", "source_name": "<outlet or null>", "evidence": "<10 words max from the source, or null>"}}`;
  let reply = null;
  if (DRY) { console.log('AP prompt:\n' + prompt); return; }
  try { reply = parseJSON(await callClaude(prompt, ['--allowedTools', 'WebSearch', 'WebFetch'], 420000)); }
  catch (e) { console.error('AP check failed:', e.message); }
  const at = process.env.CT_NOW || new Date().toISOString();
  for (const { r, why } of batch) {
    const sn = raceSnap(r);
    ap.checks[r.id] = { at, votes: sn.tot, pr: sn.pr, why, ok: !!reply };
    const v = reply && reply[String(r.id)];
    if (v && v.called === true && v.winner && v.source_url) {
      const candOk = sn.cs.some(c => c.name && v.winner && (c.name.toLowerCase().includes(String(v.winner).toLowerCase().split(' ').slice(-1)[0]) ));
      if (!candOk) { ap.log.push({ at, id: r.id, note: `rejected: winner "${v.winner}" not a listed candidate` }); continue; }
      ap.calls[r.id] = { winner: v.winner, called_at: v.called_at || null, source_url: v.source_url, source_name: v.source_name || null, evidence: v.evidence || null, found_at: at, race: `${r.state} ${r.label || r.name}` };
      ap.log.push({ at, id: r.id, note: `AP call found: ${v.winner}` });
      console.log('AP call found:', r.state, r.name, '->', v.winner);
    }
  }
  ap.updated_at = at;
  ap.log = ap.log.slice(-500);
  fs.writeFileSync(AP_FILE, JSON.stringify(ap));
  console.log('AP: checked', batch.map(b => b.r.id).join(','));
}
await apCalls();
