// County Targets: write AI blurbs with Claude Code (runs inside the GitHub job).
// Reads data/model/model.json + data/live/counties/*.json, computes verdicts with county/engine.js,
// asks Claude (via the `claude` CLI on the Max-plan OAuth token) to explain them, writes data/model/blurbs.json.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const CODE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = process.env.CT_ROOT || CODE;   // data root (override for tests)
const E = require(path.join(CODE, 'county/engine.js'));

const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const MAX_COUNTIES_PER_CALL = 30;
const DRY = process.argv.includes('--dry');          // print prompts, don't call Claude
const OUT = path.join(ROOT, 'data/model/blurbs.json');
const RN = { SEN: 'Senate', GOV: 'Governor', HOUSE: 'U.S. House' };

const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/model/model.json')));
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : { entries: {} };
const C = require(path.join(CODE, 'county/civic.js'));
const live = {};   // raceKey -> race (engine shape)
async function loadLive() {
  if (process.env.CT_LIVE_DIR) {   // test mode: civicAPI-shaped files named <id>.json
    const idx = C.buildIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'races.json'))));
    for (const [k, id] of Object.entries(idx)) {
      const f = path.join(process.env.CT_LIVE_DIR, `${id}.json`);
      if (fs.existsSync(f)) live[k] = C.toRace(JSON.parse(fs.readFileSync(f)), k);
    }
    return;
  }
  const idx = C.buildIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'races.json'))));
  const keys = Object.keys(idx).filter(k => model.geos[k] || model.geos[k.slice(0, 2)]);
  await Promise.all(keys.map(async k => {
    for (let a = 0; a < 2; a++) {
      try {
        const r = await fetch(C.API + idx[k], { signal: AbortSignal.timeout(25000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        live[k] = C.toRace(await r.json(), k); return;
      } catch (e) { if (a) console.error('civicAPI fail', k, e.message); }
    }
  }));
}
await loadLive();
const pct = x => (x * 100).toFixed(1) + '%';
const pts = x => (x >= 0 ? '+' : '-') + Math.abs(x * 100).toFixed(1);
const last = n => String(n || '').split(' ').slice(-1)[0];

function countyFacts(r, res, rk) {
  const c = E.comparisons(r, null, rk);
  const bits = [`${r.name}${r.split ? ' (part)' : ''}: verdict=${r.verdict.toUpperCase()}`,
    `${last(res.dem)} ${pct(r.A)} two-party, ~${Math.round(r.f * 100)}% of expected vote in`,
    `win pace ${pct(r.t)} (${pts(r.dev)} pts, ${r.paceNet >= 0 ? '+' : '-'}${Math.round(Math.abs(r.paceNet))} net votes vs pace)`];
  if (c.y2024) bits.push(`${c.y2024.label} ${pct(c.y2024.share)}`);
  if (c.y2024same && c.y2024same.k !== (c.y2024 || {}).k) bits.push(`${c.y2024same.label} ${pct(c.y2024same.share)}`);
  if (c.y2022) bits.push(`${c.y2022.label} ${pct(c.y2022.share)}`);
  if (c.hwm16) bits.push(`best since 2016 ${c.hwm16.label} ${pct(c.hwm16.share)}`);
  if (c.hwm) bits.push(`best since 2006 ${c.hwm.label} ${pct(c.hwm.share)}`);
  if (r.earlyOnly) bits.push('ONLY early/mail votes counted so far (these lean Dem)');
  bits.push(`expected total two-party vote ~${Math.round(r.E)}`);
  return bits.join('; ');
}

function geoFacts(geo, res, rk) {
  const tot = res.cur.D + res.cur.R + res.cur.O;
  const outstanding = res.rows.filter(r => !r.complete).map(r => ({ r, rem: Math.max(0, r.E - (r.V || 0)) }))
    .sort((a, b) => b.rem - a.rem).slice(0, 6)
    .map(({ r, rem }) => `${r.name} (~${Math.round(rem)} votes left, win pace ${pct(r.t)}${r.V ? `, running ${pts(r.dev)}` : ', nothing in yet'})`);
  const ind = Object.entries(res.cur.ind || {}).sort((a, b) => b[1] - a[1])[0];
  return [
    `${geo.name} ${RN[rk]}: ${last(res.dem)} (D) ${res.cur.D} votes vs ${last(res.rep)} (R) ${res.cur.R}${ind && ind[1] > 0.04 * tot ? `; ${last(ind[0])} (independent/other) ${ind[1]}` : ''}`,
    `~${Math.round(res.counted * 100)}% of expected vote counted; ${res.nReporting}/${res.nCounties} counties reporting`,
    `model projection: ${res.projMargin >= 0 ? 'D' : 'R'}+${Math.abs(res.projMargin * 100).toFixed(1)} final margin (uncertainty about +/-${(res.unc * 200).toFixed(1)} pts); outlook verdict=${res.outlook.toUpperCase()}`,
    `counties ahead/on/behind win pace: ${res.tally.good}/${res.tally.neutral}/${res.tally.bad}`,
    `beating pace most: ${res.helping.map(r => `${r.name} +${Math.round(r.paceNet)}`).join(', ') || 'none'}`,
    `trailing pace most: ${res.hurting.map(r => `${r.name} -${Math.round(Math.abs(r.paceNet))}`).join(', ') || 'none'}`,
    `largest uncounted vote: ${outstanding.join('; ')}`,
    geo.lines_note ? `district lines: ${geo.lines_note}` : '',
  ].filter(Boolean).join('\n');
}

const INSTRUCTIONS = `You are writing live election-night notes for a small Democratic-aligned team watching county returns.
"Win pace" = the two-party Democratic share each county must hit for the Democrat to win the state/district. The VERDICT for each county and the OUTLOOK verdict are already decided by fixed rules. Never contradict them; your job is to explain why in plain, specific language using only the numbers given.

County notes: 1-2 sentences, max 35 words. Say what the result means: e.g. which past benchmark it beats or trails (2024, 2022, best-ever), whether it's a big or small vote source, and any caveat (early/mail-only votes, small share counted, split county). Use numbers sparingly and exactly as given.
Outlook: 3-4 sentences, max 90 words. Where the race stands, which counties are driving it, where the remaining vote is and whether it should help or hurt. No hedging filler.

Style: direct, peer-to-peer, like a sharp campaign analyst texting the team. No cheerleading, no "it's not X, it's Y" constructions, no rhetorical questions, no em dashes, no exclamation points.

Return ONLY a JSON object, no prose, no code fences:
{"outlooks": {"<race_id>": "..."}, "counties": {"<race_id>": {"<fips>": "..."}}}`;

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', MODEL, '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, 240000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 400)}`)); });
    p.stdin.end(prompt);
  });
}
function parseJSON(txt) {
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('no json in reply');
  return JSON.parse(txt.slice(a, b + 1));
}

// Build one job per state (both statewide races) and one for all districts.
const jobs = {};
const now = new Date().toISOString();
const out = { updated_at: now, entries: JSON.parse(JSON.stringify(prev.entries || {})) };
for (const [id, geo] of Object.entries(model.geos)) {
  const st = geo.state;
  for (const rk of geo.type === 'cd' ? ['HOUSE'] : geo.races) {
    const rid = geo.type === 'cd' ? id : `${id}-${rk}`;
    const race = live[rid];
    if (!race) continue;
    const res = E.compute(geo, race, { target: 0.5 });
    if (!res.nReporting) continue;
    const pe = (prev.entries || {})[rid] || {};
    const pc = pe.counties || {};
    const changed = res.rows.filter(r => r.V > 0 && r.verdict !== 'early' && (!pc[r.fips] || pc[r.fips].sig !== E.signature(r)))
      .sort((a, b) => Math.abs(b.paceNet) - Math.abs(a.paceNet)).slice(0, MAX_COUNTIES_PER_CALL);
    const countedMoved = !pe.outlook || Math.abs((pe.outlook.counted || 0) - res.counted) > 0.01 || pe.outlook.verdict !== res.outlook;
    if (!changed.length && !countedMoved) continue;
    const key = geo.type === 'cd' ? 'CDS' : st;
    (jobs[key] = jobs[key] || []).push({ rid, res, rk, geo, changed });
  }
}

const keys = Object.keys(jobs);
console.log(`[${now}] jobs:`, keys.map(k => `${k}(${jobs[k].map(j => j.rid + ':' + j.changed.length).join(',')})`).join(' ') || 'none');

async function runJob(k) {
  const items = jobs[k];
  const prompt = INSTRUCTIONS + '\n\n' + items.map(j =>
    `=== race_id ${j.rid} ===\n${geoFacts(j.geo, j.res, j.rk)}\nCounties needing notes (fips | facts):\n` +
    (j.changed.map(r => `${r.fips} | ${countyFacts(r, j.res, j.rk)}`).join('\n') || '(none, outlook only)')).join('\n\n');
  if (DRY) { console.log(prompt); return; }
  let reply;
  try { reply = parseJSON(await callClaude(prompt)); }
  catch (e) { console.error(`[${k}] Claude failed:`, e.message); return; }
  for (const j of items) {
    const ent = out.entries[j.rid] = out.entries[j.rid] || { counties: {} };
    ent.counties = ent.counties || {};
    const o = (reply.outlooks || {})[j.rid];
    if (o) ent.outlook = { text: String(o).slice(0, 700), at: new Date().toISOString(), counted: +j.res.counted.toFixed(3), verdict: j.res.outlook };
    const cs = (reply.counties || {})[j.rid] || {};
    for (const r of j.changed) {
      const t = cs[r.fips];
      if (t) ent.counties[r.fips] = { text: String(t).slice(0, 400), at: new Date().toISOString(), sig: E.signature(r), verdict: r.verdict };
    }
  }
}

// run up to 3 Claude calls at once
const queue = keys.slice();
await Promise.all([0, 1, 2].map(async () => { while (queue.length) await runJob(queue.shift()); }));
if (!DRY) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('wrote', OUT);
}
