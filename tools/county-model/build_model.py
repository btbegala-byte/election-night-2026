"""Build data/model/model.json: per-county baselines, history, high-water marks for SAM geographies."""
import pandas as pd, numpy as np, json, os

RAW = '/home/claude/data/raw'
OUT = '/home/claude/site/data/model/model.json'
ST_NAMES = {'GA': 'Georgia', 'IA': 'Iowa', 'MI': 'Michigan', 'NC': 'North Carolina', 'OH': 'Ohio', 'TX': 'Texas'}
ST_FIPS = {'GA': '13', 'IA': '19', 'MI': '26', 'NC': '37', 'OH': '39', 'TX': '48'}

# 2026 races on the ballot (statewide) — target model is shared; live race toggled in page
RACES_2026 = {'GA': ['SEN', 'GOV'], 'IA': ['SEN', 'GOV'], 'MI': ['SEN', 'GOV'], 'NC': ['SEN'], 'OH': ['SEN', 'GOV'], 'TX': ['SEN', 'GOV']}
# 2022 races used for midterm geography in the baseline blend
MID22 = {'GA': ['SEN', 'GOV'], 'IA': ['SEN', 'GOV'], 'MI': ['GOV'], 'NC': ['SEN'], 'OH': ['SEN'], 'TX': ['GOV']}
W_PRES24, W_MID22 = 0.6, 0.4

CDS = {'IA-01': ('IA', 1), 'IA-02': ('IA', 2), 'MI-04': ('MI', 4), 'MI-10': ('MI', 10), 'NC-05': ('NC', 5),
       'NC-11': ('NC', 11), 'OH-07': ('OH', 7), 'TX-15': ('TX', 15), 'TX-23': ('TX', 23)}
# 2024 Trump margin on 2026 lines (270toWin/DRA estimates) for districts redrawn in 2025; None = lines unchanged
NEWLINE_PRES24_MARGIN_R = {'TX-23': 14.8, 'OH-07': 11.0, 'TX-15': 17.8}
LINES_NOTE = {
    'TX-15': 'Redrawn in 2025; 2024 presidential margin on new lines is unchanged (R+17.8). County parts use 2024 lines.',
    'TX-23': 'Redrawn in 2025 (slightly bluer, R+14.8 vs R+15.5). County parts use 2024 lines, calibrated to the new-line margin.',
    'OH-07': 'Redrawn in 2025 (slightly redder, R+11.0 vs R+10.6). County parts use 2024 lines, calibrated to the new-line margin.',
    'NC-05': 'Lines unchanged since 2024. 2022 House results were on different lines and are omitted.',
    'NC-11': 'Lines unchanged since 2024. 2022 House results were on different lines and are omitted.',
}
# Democratic candidate labels for history / high-water-mark display
DEMS = {
 ('ALL', 2008, 'PRES'): 'Obama', ('ALL', 2012, 'PRES'): 'Obama', ('ALL', 2016, 'PRES'): 'Clinton', ('ALL', 2020, 'PRES'): 'Biden', ('ALL', 2024, 'PRES'): 'Harris',
 ('GA', 2018, 'GOV'): 'Abrams', ('IA', 2018, 'GOV'): 'Hubbell', ('MI', 2018, 'GOV'): 'Whitmer', ('MI', 2018, 'SEN'): 'Stabenow',
 ('OH', 2018, 'GOV'): 'Cordray', ('OH', 2018, 'SEN'): 'Brown', ('TX', 2018, 'GOV'): 'Valdez', ('TX', 2018, 'SEN'): "O'Rourke",
 ('GA', 2022, 'SEN'): 'Warnock', ('GA', 2022, 'GOV'): 'Abrams', ('IA', 2022, 'GOV'): 'DeJear', ('IA', 2022, 'SEN'): 'Franken',
 ('MI', 2022, 'GOV'): 'Whitmer', ('NC', 2022, 'SEN'): 'Beasley', ('OH', 2022, 'GOV'): 'Whaley', ('OH', 2022, 'SEN'): 'Ryan',
 ('TX', 2022, 'GOV'): "O'Rourke", ('MI', 2024, 'SEN'): 'Slotkin', ('NC', 2024, 'GOV'): 'Stein', ('OH', 2024, 'SEN'): 'Brown',
 ('TX', 2024, 'SEN'): 'Allred',
 ('GA', 2006, 'GOV'): 'Taylor', ('IA', 2006, 'GOV'): 'Culver', ('MI', 2006, 'GOV'): 'Granholm', ('MI', 2006, 'SEN'): 'Stabenow',
 ('OH', 2006, 'GOV'): 'Strickland', ('OH', 2006, 'SEN'): 'Brown', ('TX', 2006, 'SEN'): 'Radnofsky', ('TX', 2006, 'GOV'): 'Bell',
 ('GA', 2008, 'SEN'): 'Martin', ('IA', 2008, 'SEN'): 'Harkin', ('MI', 2008, 'SEN'): 'Levin', ('NC', 2008, 'SEN'): 'Hagan',
 ('NC', 2008, 'GOV'): 'Perdue', ('TX', 2008, 'SEN'): 'Noriega',
 ('GA', 2010, 'GOV'): 'Barnes', ('GA', 2010, 'SEN'): 'Thurmond', ('IA', 2010, 'GOV'): 'Culver', ('IA', 2010, 'SEN'): 'Conlin',
 ('MI', 2010, 'GOV'): 'Bernero', ('NC', 2010, 'SEN'): 'Marshall', ('OH', 2010, 'GOV'): 'Strickland', ('OH', 2010, 'SEN'): 'Fisher',
 ('TX', 2010, 'GOV'): 'White', ('MI', 2012, 'SEN'): 'Stabenow', ('NC', 2012, 'GOV'): 'Dalton', ('OH', 2012, 'SEN'): 'Brown',
 ('TX', 2012, 'SEN'): 'Sadler', ('GA', 2014, 'GOV'): 'Carter', ('GA', 2014, 'SEN'): 'Nunn', ('IA', 2014, 'GOV'): 'Hatch',
 ('IA', 2014, 'SEN'): 'Braley', ('MI', 2014, 'GOV'): 'Schauer', ('MI', 2014, 'SEN'): 'Peters', ('NC', 2014, 'SEN'): 'Hagan',
 ('OH', 2014, 'GOV'): 'FitzGerald', ('TX', 2014, 'GOV'): 'Davis', ('TX', 2014, 'SEN'): 'Alameel',
 ('GA', 2016, 'SEN'): 'Barksdale', ('IA', 2016, 'SEN'): 'Judge', ('NC', 2016, 'SEN'): 'Ross', ('NC', 2016, 'GOV'): 'Cooper',
 ('OH', 2016, 'SEN'): 'Strickland', ('GA', 2020, 'SEN'): 'Ossoff', ('IA', 2020, 'SEN'): 'Greenfield', ('MI', 2020, 'SEN'): 'Peters',
 ('NC', 2020, 'SEN'): 'Cunningham', ('NC', 2020, 'GOV'): 'Cooper', ('TX', 2020, 'SEN'): 'Hegar',
}
# races excluded from the high-water mark (multi-candidate distortions)
HWM_EXCLUDE = {('TX', 2006, 'GOV'), ('GA', 2020, 'SEN_SPEC')}
RLAB = {'PRES': 'Pres', 'SEN': 'Sen', 'GOV': 'Gov', 'SEN_SPEC': 'Sen (special)', 'HOUSE': 'House'}

def logit(p): p = np.clip(p, 1e-4, 1 - 1e-4); return np.log(p / (1 - p))

def label(st, yr, race):
    nm = DEMS.get((st, yr, race)) or DEMS.get(('ALL', yr, race))
    return f"{yr} {RLAB.get(race, race)}" + (f" ({nm})" if nm else '')

# ---------- load ----------
def load_pres():
    rows = []
    a = pd.read_csv(f'{RAW}/pres_2008.csv', dtype={'fips_code': str})
    for yr in (2008, 2012, 2016):
        rows.append(pd.DataFrame({'county_fips': a.fips_code.str.zfill(5), 'year': yr, 'race': 'PRES', 'D': a[f'dem_{yr}'], 'R': a[f'gop_{yr}']}))
    for yr in (2020, 2024):
        b = pd.read_csv(f'{RAW}/pres_{yr}.csv', dtype={'county_fips': str})
        rows.append(pd.DataFrame({'county_fips': b.county_fips.str.zfill(5), 'year': yr, 'race': 'PRES', 'D': b.votes_dem, 'R': b.votes_gop}))
    p = pd.concat(rows)
    p['state'] = p.county_fips.str[:2].map({v: k for k, v in ST_FIPS.items()})
    return p[p.state.notna()]

pres = load_pres()
med = pd.read_csv('/home/claude/build/medsl_county.csv', dtype={'county_fips': str})
med = med[med.race.isin(['SEN', 'GOV', 'SEN_SPEC'])]  # PRES 2024 from tonmcg already
hist = [pres, med[['county_fips', 'year', 'race', 'D', 'R', 'state']]]
if os.path.exists('/home/claude/build/oe_hwm.csv'):
    oe = pd.read_csv('/home/claude/build/oe_hwm.csv', dtype={'county_fips': str})
    oe['county_fips'] = oe.county_fips.str.zfill(5)
    hist.append(oe[['county_fips', 'year', 'race', 'D', 'R', 'state']])
H = pd.concat(hist).drop_duplicates(['county_fips', 'year', 'race'], keep='last')
H = H[(H.D + H.R) > 0]
H = H[~((H.state == 'GA') & (H.year == 2020) & (H.race == 'SEN_SPEC'))]
H['share'] = H.D / (H.D + H.R)

names = pd.read_csv(f'{RAW}/pres_2024.csv', dtype={'county_fips': str})
names = dict(zip(names.county_fips.str.zfill(5), names.county_name.str.replace(' County', '', regex=False)))

cdp = pd.read_csv('/home/claude/build/medsl_cdpart.csv', dtype={'county_fips': str})

def hist_entries(st, g):
    out = []
    for _, r in g.sort_values(['year', 'race'], ascending=[False, True]).iterrows():
        out.append({'k': f"{int(r.year)}-{r.race}", 'label': label(st, int(r.year), r.race), 'd': int(r.D), 'r': int(r.R)})
    return out

def hwm(st, g, since=2006):
    g = g[g.year >= since]
    g = g[[(st, int(y), rc) not in HWM_EXCLUDE for y, rc in zip(g.year, g.race)]]
    if not len(g): return None
    g = g.reset_index(drop=True); r = g.loc[g.share.idxmax()]
    return {'share': round(float(r.share), 4), 'label': label(st, int(r.year), r.race), 'margin': int(r.D - r.R)}

def solve_swing(b, w, target):
    lo, hi = -5.0, 5.0
    for _ in range(80):
        m = (lo + hi) / 2
        if (w * (1 / (1 + np.exp(-(b + m))))).sum() / w.sum() < target: lo = m
        else: hi = m
    return (lo + hi) / 2

model = {'generated': pd.Timestamp.now('UTC').isoformat(), 'method': {
    'baseline': f'{int(W_PRES24*100)}% 2024 presidential + {int(W_MID22*100)}% 2022 midterm statewide race(s), blended in log-odds; two-party Dem share',
    'swing': 'Proportional (log-odds) swing applied equally to every county until the geography hits the target two-party share',
    'turnout': 'Expected 2026 two-party vote = 2022 two-party vote in the same county (re-estimated live from fully counted counties)'},
    'geos': {}}

years_cov = H.groupby('state').apply(lambda x: sorted({f"{int(y)} {RLAB.get(r, r)}" for y, r in zip(x.year, x.race)}), include_groups=False).to_dict()

for st in ST_NAMES:
    Hs = H[H.state == st]
    p24 = Hs[(Hs.year == 2024) & (Hs.race == 'PRES')].set_index('county_fips')
    mids = [Hs[(Hs.year == 2022) & (Hs.race == r)].set_index('county_fips') for r in MID22[st]]
    fips = sorted(p24.index)
    b24 = logit(p24.loc[fips, 'share'].values)
    bm = np.mean([logit(m.loc[fips, 'share'].values) for m in mids], axis=0)
    base = W_PRES24 * b24 + W_MID22 * bm
    w = np.mean([(m.loc[fips, 'D'] + m.loc[fips, 'R']).values for m in mids], axis=0)
    counties = []
    for i, f in enumerate(fips):
        g = Hs[Hs.county_fips == f]
        counties.append({'fips': f, 'name': names.get(f, f), 'b': round(float(base[i]), 5), 'w': int(round(w[i])),
                         'hist': hist_entries(st, g), 'hwm': hwm(st, g), 'hwm16': hwm(st, g, 2016)})
    s50 = solve_swing(base, w, 0.5)
    model['geos'][st] = {'id': st, 'type': 'state', 'name': ST_NAMES[st], 'state': st, 'races': RACES_2026[st],
                         'counties': counties, 'hwm_coverage': years_cov.get(st, []),
                         'baseline_share': round(float((w * (1 / (1 + np.exp(-base)))).sum() / w.sum()), 4),
                         'swing_to_win': round(float(s50), 4)}

# ---------- congressional districts ----------
for cd, (st, dn) in CDS.items():
    x = cdp[(cdp.state == st) & (cdp.dn == dn)]
    p = x[(x.year == 2024) & (x.race == 'PRES')].set_index('county_fips')
    fips = sorted(p.index)
    share24 = p.loc[fips, 'D'] / (p.loc[fips, 'D'] + p.loc[fips, 'R'])
    b = logit(share24.values)
    same_lines_2022 = st in ('IA', 'MI', 'TX', 'OH')  # 2022 & 2024 used the same CD lines in these states
    if same_lines_2022:
        m = x[(x.year == 2022) & (x.race.isin(MID22[st]))]
        mm = m.groupby('county_fips')[['D', 'R']].sum().reindex(fips)
        if mm.notna().all().all():
            b = W_PRES24 * b + W_MID22 * logit((mm.D / (mm.D + mm.R)).values)
            w = (m[m.race == MID22[st][0]].set_index('county_fips').reindex(fips).eval('D+R')).values
        else:
            same_lines_2022 = False
    if not same_lines_2022:
        st_ratio = sum((H[(H.state == st) & (H.year == 2022) & (H.race == r)].eval('D+R')).sum() for r in MID22[st][:1]) / \
                   H[(H.state == st) & (H.year == 2024) & (H.race == 'PRES')].eval('D+R').sum()
        w = (p.loc[fips, 'D'] + p.loc[fips, 'R']).values * st_ratio
    # calibrate to new-line 2024 presidential margin where districts were redrawn
    if cd in NEWLINE_PRES24_MARGIN_R:
        cur = (p.loc[fips, 'D'].sum()) / (p.loc[fips, 'D'].sum() + p.loc[fips, 'R'].sum())
        tgt = (100 - NEWLINE_PRES24_MARGIN_R[cd]) / 200
        b = b + (logit(np.array([tgt]))[0] - logit(np.array([cur]))[0])
    counties = []
    whole = {f: (x[(x.year == 2024) & (x.race == 'PRES') & (x.county_fips == f)].eval('D+R').sum() /
                 max(1, H[(H.county_fips == f) & (H.year == 2024) & (H.race == 'PRES')].eval('D+R').sum())) for f in fips}
    for i, f in enumerate(fips):
        part = x[x.county_fips == f]
        ph = []
        for _, r in part.sort_values(['year', 'race'], ascending=[False, True]).iterrows():
            if r.race not in ('PRES', 'SEN', 'GOV', 'HOUSE'): continue
            if r.year == 2022 and not same_lines_2022 and r.race == 'HOUSE': continue
            if r.year == 2018: continue
            if r.year == 2022 and st == 'NC': continue
            ph.append({'k': f"{int(r.year)}-{r.race}", 'label': label(st, int(r.year), r.race) if r.race != 'HOUSE' else f"{int(r.year)} House",
                       'd': int(r.D), 'r': int(r.R)})
        g = H[H.county_fips == f]
        split = whole[f] < 0.98
        counties.append({'fips': f, 'name': names.get(f, f), 'b': round(float(b[i]), 5), 'w': int(round(w[i])),
                         'split': bool(split), 'part_share_of_county': round(float(min(1, whole[f])), 3),
                         'hist': ph, 'county_hist': hist_entries(st, g), 'hwm': hwm(st, g), 'hwm16': hwm(st, g, 2016)})
    ww = np.array([c['w'] for c in counties]); bb = np.array([c['b'] for c in counties])
    model['geos'][cd] = {'id': cd, 'type': 'cd', 'name': f"{ST_NAMES[st]} {dn}{'st' if dn in (1,) else 'nd' if dn==2 else 'th'} District",
                         'state': st, 'races': ['HOUSE'], 'counties': counties, 'lines_note': LINES_NOTE.get(cd, 'Lines unchanged since 2022.'),
                         'baseline_share': round(float((ww / (1 + np.exp(-bb))).sum() / ww.sum()), 4),
                         'swing_to_win': round(float(solve_swing(bb, ww, 0.5)), 4)}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(model, open(OUT, 'w'), separators=(',', ':'))
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
for k, g in model['geos'].items():
    print(k, len(g['counties']), 'baseline D share', g['baseline_share'], 'swing logit', g['swing_to_win'])
