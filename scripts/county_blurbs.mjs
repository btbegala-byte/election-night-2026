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
const RACES = JSON.parse(fs.readFileSync(path.join(ROOT, 'races.json'))).races || [];
const RAW = {};    // civicAPI race id -> raw JSON (every race on the dashboard, for the race snapshots)
async function loadLive() {
  const idx = C.buildIndex({ races: RACES });
  const byId = Object.fromEntries(Object.entries(idx).map(([k, id]) => [id, k]));
  const getOne = async id => {
    if (process.env.CT_LIVE_DIR) {   // test mode: civicAPI-shaped files named <id>.json
      const f = path.join(process.env.CT_LIVE_DIR, `${id}.json`);
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : null;
    }
    for (let a = 0; a < 2; a++) {
      try {
        const r = await fetch(C.API + id, { signal: AbortSignal.timeout(25000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) { if (a) console.error('civicAPI fail', id, e.message); }
    }
    return null;
  };
  const queue = RACES.map(r => r.id);
  await Promise.all([1, 2, 3, 4, 5, 6].map(async () => {
    while (queue.length) {
      const id = queue.shift(); const j = await getOne(id);
      if (!j) continue;
      RAW[id] = j;
      if (byId[id]) live[byId[id]] = C.toRace(j, byId[id]);
    }
  }));
}
await loadLive();
if (!DRY) try { fs.writeFileSync(process.env.CT_RAW_OUT || '/tmp/ct_raw.json', JSON.stringify(RAW)); } catch (e) { /* ignore */ }
// T1-1: archive every raw civicAPI response from this cycle (one gzipped file per cycle; the workflow pushes it to the 'archive' branch)
if (process.env.CT_ARCHIVE_DIR && !DRY) {
  const zlib = await import('zlib');
  fs.mkdirSync(process.env.CT_ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(process.env.CT_ARCHIVE_DIR, `${stamp}.json.gz`), zlib.gzipSync(JSON.stringify({ fetched_at: new Date().toISOString(), races: RAW })));
  console.log('archived', Object.keys(RAW).length, 'races');
}
const pct = x => (x * 100).toFixed(1) + '%';
const pts = x => (x >= 0 ? '+' : '-') + Math.abs(x * 100).toFixed(1);
const last = n => String(n || '').split(' ').slice(-1)[0];

function countyFacts(r, res, rk) {
  const c = E.comparisons(r, null, rk);
  const bits = [`${r.name}${r.split ? ' (part)' : ''}: verdict=${r.verdict.toUpperCase()}`,
    `${last(res.dem)} ${pct(r.A)} two-party, ~${Math.round(r.f * 100)}% of expected vote in`,
    `win pace ${pct(r.t)} (${pts(r.dev)} pts, ${r.paceNet >= 0 ? '+' : '-'}${Math.round(Math.abs(r.paceNet))} net votes vs pace now; projected full-count ${r.projNet >= 0 ? '+' : '-'}${Math.round(Math.abs(r.projNet))})`];
  if (r.likelyEarly) bits.push(`LIKELY EARLY/MAIL VOTES ONLY${r.earlyDelta != null ? ` (pace for early votes, from 2022 skew: ${pct(r.tE)})` : ''}`);
  if (r.lowImpact) bits.push('low impact (under 1,000 projected net votes vs pace)');
  if (c.y2024) bits.push(`${c.y2024.label} ${pct(c.y2024.share)}`);
  if (c.y2024same && c.y2024same.k !== (c.y2024 || {}).k) bits.push(`${c.y2024same.label} ${pct(c.y2024same.share)}`);
  if (c.y2022) bits.push(`${c.y2022.label} ${pct(c.y2022.share)}`);
  if (c.hwm16) bits.push(`best since 2016 ${c.hwm16.label} ${pct(c.hwm16.share)}`);
  if (c.hwm) bits.push(`best since 2006 ${c.hwm.label} ${pct(c.hwm.share)}`);
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
    `counties ahead/on/behind win pace: ${res.tally.good}/${res.tally.neutral}/${res.tally.bad}${res.tally.goodEarly ? ` (+${res.tally.goodEarly} ahead on likely early votes only)` : ''}`,
    `alt model v2 (testing, projects uncounted counties by county type): ${res.v2.margin >= 0 ? 'D' : 'R'}+${Math.abs(res.v2.margin * 100).toFixed(1)}, 90% range ${pct(res.v2.lo)}-${pct(res.v2.hi)} Dem two-party`,
    (() => { const sp = res.shiftPanel.filter(x => x.done > 0); return sp.length ? 'fully counted counties by type, observed vs needed shift (log-odds; 0.1 ~ 2.5 pts): ' + sp.map(x => `${x.label} ${x.done}/${x.counties}: ${x.observedShift.toFixed(3)} vs ${x.neededShift.toFixed(3)}`).join('; ') : ''; })(),
    res.earlyWindow ? 'within 45 minutes of poll close: every county is treated as likely early votes only' : '',
    `beating pace most (projected full-count net votes): ${res.helping.map(r => `${r.name}${r.likelyEarly ? ' (early only)' : ''} +${Math.round(r.projNet)}`).join(', ') || 'none'}`,
    `trailing pace most (projected full-count net votes): ${res.hurting.map(r => `${r.name}${r.likelyEarly ? ' (early only)' : ''} -${Math.round(Math.abs(r.projNet))}`).join(', ') || 'none'}`,
    `largest uncounted vote: ${outstanding.join('; ')}`,
    geo.lines_note ? `district lines: ${geo.lines_note}` : '',
  ].filter(Boolean).join('\n');
}

const INSTRUCTIONS = `You are writing live election-night notes for a small Democratic-aligned team watching county returns.
"Win pace" = the two-party Democratic share each county must hit for the Democrat to win the state/district. The VERDICT for each county and the OUTLOOK verdict are already decided by fixed rules. Never override them; explain why in plain, specific language using only the numbers given. You may add a caveat to a verdict when the county is flagged LIKELY EARLY/MAIL VOTES ONLY, or when the main projection and the alt model v2 disagree by more than 1 point (e.g. "ahead, but only early votes are counted"). In IA, OH and TX, small counties falling short of the needed shift is the expected shape of a Dem win; don't read it as bad news on its own.

County notes: 1-2 sentences, max 35 words. Say what the result means: e.g. which past benchmark it beats or trails (2024, 2022, best-ever), whether it's a big or small vote source, and any caveat (early/mail-only votes, small share counted, split county). Use numbers sparingly and exactly as given.
Outlook: 3-4 sentences, max 90 words. Where the race stands, which counties are driving it, where the remaining vote is and whether it should help or hurt. No hedging filler.

Style: direct, peer-to-peer, like a sharp campaign analyst texting the team. No cheerleading, no "it's not X, it's Y" constructions, no rhetorical questions, no em dashes, no exclamation points.

Return ONLY a JSON object, no prose, no code fences:
{"outlooks": {"<race_id>": "..."}, "counties": {"<race_id>": {"<fips>": "..."}}}`;

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
    const res = E.compute(geo, race, { target: 0.5, raceKey: rk });
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
    if (o) ent.outlook = { text: String(o).slice(0, 700), at: new Date().toISOString(), data_at: (live[j.rid] || {}).source_updated || null, counted: +j.res.counted.toFixed(3), verdict: j.res.outlook };
    const cs = (reply.counties || {})[j.rid] || {};
    for (const r of j.changed) {
      const t = cs[r.fips];
      if (t) ent.counties[r.fips] = { text: String(t).slice(0, 400), at: new Date().toISOString(), data_at: (live[j.rid] || {}).source_updated || null, sig: E.signature(r), verdict: r.verdict, early: !!r.likelyEarly };
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

// ---------- Race snapshots: one per state + one overall, written whenever that state's numbers move ----------
const SNAP = path.join(ROOT, 'data/model/snapshots.json');
const STATES = { GA: 'Georgia', NC: 'North Carolina', OH: 'Ohio', MI: 'Michigan', TX: 'Texas', IA: 'Iowa' };
const snaps = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP)) : { entries: [] };
const lastFor = scope => { for (let i = snaps.entries.length - 1; i >= 0; i--) if (snaps.entries[i].scope === scope) return snaps.entries[i]; return null; };
const abbr = p => { const x = String(p || '').toLowerCase(); return x.startsWith('dem') ? 'D' : x.startsWith('rep') ? 'R' : x.startsWith('lib') ? 'L' : x.startsWith('green') ? 'G' : x.startsWith('ind') ? 'I' : (p || '?'); };

function stateFacts(st) {
  const lines = []; let votes = 0;
  for (const r of RACES.filter(x => x.state === st)) {
    const d = RAW[r.id]; if (!d || !d.candidates) continue;
    const tot = d.candidates.reduce((a, c) => a + (+c.votes || 0), 0); votes += tot;
    if (!tot) continue;
    const cs = d.candidates.filter(c => +c.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 3)
      .map(c => `${c.name} (${abbr(c.party)}) ${c.votes} ${(100 * c.votes / tot).toFixed(1)}%`).join('; ');
    const apc = apCallsNow()[r.id];
    lines.push(`${r.label || r.name}${r.target ? ' [SAM target]' : ''} [${d.percent_reporting ?? '?'}% reporting]: ${cs}${apc ? ` — AP CALLED for ${apc.winner}` : ''}`);
  }
  const model = [];
  for (const [id, geo] of Object.entries(model_geos())) {
    if (geo.state !== st) continue;
    for (const rk of geo.type === 'cd' ? ['HOUSE'] : geo.races) {
      const rid = geo.type === 'cd' ? id : `${id}-${rk}`;
      if (!live[rid]) continue;
      const res = E.compute(geo, live[rid], { target: 0.5, raceKey: rk });
      if (res.nReporting) model.push(geoFacts(geo, res, rk));
    }
  }
  return { votes, text: (lines.length ? 'Race totals:\n' + lines.join('\n') : 'No votes yet.') + (model.length ? '\n\nCounty win-pace model:\n' + model.join('\n\n') : '') };
}
function model_geos() { return model.geos; }
function apCallsNow() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/model/ap_calls.json'))).calls || {}; } catch (e) { return {}; } }

const SNAP_INSTRUCTIONS = `You write the "race snapshot" at the top of an election-night results dashboard for a small Democratic-aligned team. Write from the data only; never invent numbers or calls. "Win pace" is the two-party Dem share a county or state must hit for a Dem win; the projection is the team's own model, not a race call, so call it "our model" when you cite it. Results are unofficial (civicAPI).
For each state scope: 3-5 sentences. Lead with the top-of-ticket standing and how much is counted, then whether the Dem is on, ahead of, or behind win pace and which counties are driving it, then the SAM target districts, then any notable down-ballot result. If a previous snapshot is given, say in one clause what changed since then.
For the ALL scope: 4-6 sentences across the six states: which races look good, bad or too early, and the single most important thing to watch next.
Style: direct, specific, peer-to-peer. No cheerleading, no hedging filler, no em dashes, no rhetorical questions, no "it's not X, it's Y". Plain text, no markdown.
Return ONLY a JSON object mapping scope to text, e.g. {"GA": "...", "ALL": "..."}. Include exactly the scopes requested.`;

async function snapshots() {
  const changed = [];
  const facts = {};
  for (const st of Object.keys(STATES)) {
    const f = stateFacts(st); facts[st] = f;
    if (!f.votes) continue;
    const prevS = lastFor(st);
    if (!prevS || prevS.sig !== String(f.votes)) changed.push(st);
  }
  if (!changed.length) { console.log('snapshots: no new votes'); return; }
  const scopes = changed.concat(['ALL']);
  const prompt = SNAP_INSTRUCTIONS + `\n\nScopes requested: ${scopes.join(', ')}\nTime: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET\n\n` +
    Object.keys(STATES).filter(st => facts[st].votes).map(st => {
      const p = lastFor(st);
      return `=== ${st} (${STATES[st]})${changed.includes(st) ? '' : ' [no change since last snapshot; context only]'} ===\n${facts[st].text}` +
        (p ? `\nPrevious ${st} snapshot (${p.at}): ${p.text}` : '');
    }).join('\n\n') + (lastFor('ALL') ? `\n\nPrevious ALL snapshot (${lastFor('ALL').at}): ${lastFor('ALL').text}` : '');
  if (DRY) { console.log(prompt.slice(0, 3000)); return; }
  let reply;
  try { reply = parseJSON(await callClaude(prompt)); } catch (e) { console.error('snapshot Claude failed:', e.message); return; }
  const at = new Date().toISOString();
  for (const sc of scopes) {
    if (!reply[sc]) continue;
    snaps.entries.push({ scope: sc, at, text: String(reply[sc]).slice(0, 1500), sig: sc === 'ALL' ? scopes.join(',') : String(facts[sc].votes), votes: sc === 'ALL' ? Object.values(facts).reduce((a, f) => a + f.votes, 0) : facts[sc].votes });
  }
  snaps.updated_at = at;
  fs.writeFileSync(SNAP, JSON.stringify(snaps));
  console.log('snapshots written:', scopes.join(','));
}
await snapshots();
