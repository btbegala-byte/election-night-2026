import pandas as pd, re, sys, csv
R = '/home/claude/data/raw/'

ABBR = {'Georgia': 'GA', 'Iowa': 'IA', 'Michigan': 'MI', 'North Carolina': 'NC', 'Ohio': 'OH', 'Texas': 'TX'}

def norm(s):
    s = str(s).lower().strip()
    s = re.sub(r'\s+(county|parish)$', '', s)
    s = re.sub(r'^saint\b', 'st', s)
    s = re.sub(r'^st\.?\s', 'st ', s)
    return re.sub(r'[^a-z]', '', s)

p = pd.read_csv(R + 'pres_2024.csv', dtype=str)
p = p[p.state_name.isin(ABBR)]
FIPS = {}
for _, r in p.iterrows():
    FIPS.setdefault(ABBR[r.state_name], {})[norm(r.county_name)] = r.county_fips
BAD = ['total','totals','statetotals','statetotal','','grandtotals','statewide','nan']
for st_, a_, b_ in [('MI','gdtraverse','grandtraverse'),('MI','shiawasse','shiawassee'),('TX','hildalgo','hidalgo')]:
    FIPS[st_][a_] = FIPS[st_][b_]

def votes_of(d, cols):
    if isinstance(cols, str):
        return pd.to_numeric(d[cols].astype(str).str.replace(',', ''), errors='coerce').fillna(0)
    return sum(pd.to_numeric(d[c].astype(str).str.replace(',', ''), errors='coerce').fillna(0) for c in cols)

CACHE = {}
def load(f):
    if f not in CACHE:
        CACHE[f] = pd.read_csv(R + f, dtype=str, low_memory=False, encoding='latin-1')
    return CACHE[f]

def extract(st, f, office_re, d_re, r_re, cc='county', vc='votes', by='candidate', office_col='office', excl_precinct_total=True, drop_na_precinct=False):
    d = load(f)
    d = d[d[office_col].fillna('').str.contains(office_re, case=False, regex=True)]
    if 'precinct' in d.columns and excl_precinct_total:
        d = d[~d.precinct.fillna('').str.strip().str.lower().isin(['total', 'totals', 'county total', 'total votes'])]
        if drop_na_precinct: d = d[d.precinct.notna()]
    d = d.assign(v=votes_of(d, vc), k=d[cc].map(norm))
    d = d[~d.k.isin(BAD)]
    col = d[by].fillna('')
    D = d[col.str.contains(d_re, case=False, regex=True)].groupby('k').v.sum()
    Rr = d[col.str.contains(r_re, case=False, regex=True)].groupby('k').v.sum()
    return D, Rr

RACES = [
 # state, year, race, file, office_re, D_re, R_re, kwargs
 ('GA',2006,'GOV','oe_ga/2006/20061107__ga__general.csv','^Governor$','Mark Taylor','Sonny Perdue',{}),
 ('GA',2008,'SEN','oe_ga/2008/20081104__ga__general.csv','^U.S. Senate$','Jim Martin','Chambliss',{}),
 ('GA',2010,'SEN','oe_ga/2010/20101102__ga__general.csv','^U.S. Senate$','Thurmond','Isakson',{}),
 ('GA',2010,'GOV','oe_ga/2010/20101102__ga__general.csv','^Governor$','Barnes','Nathan Deal',{}),
 ('GA',2014,'SEN','oe_ga/2014/20141104__ga__general__county-level.csv','^U.S. Senate$','NUNN','PERDUE',dict(vc=['election_day_votes','advanced_votes','absentee_by_mail_votes','provisional_votes'])),
 ('GA',2014,'GOV','oe_ga/2014/20141104__ga__general__county-level.csv','^Governor$','CARTER','DEAL',dict(vc=['election_day_votes','advanced_votes','absentee_by_mail_votes','provisional_votes'])),
 ('GA',2016,'SEN','oe_ga/2016/20161108__ga__general.csv','^United States Senator$','BARKSDALE','ISAKSON',{}),
 ('GA',2020,'SEN','oe_ga/2020/20201103__ga__general.csv','^U.S. Senate$','Ossoff','Perdue',dict(vc=['election_day_votes','advanced_votes','absentee_by_mail_votes','provisional_votes'])),
 # jungle special: sum of all Dem vs all Rep candidates (no nominees)
 ('GA',2020,'SEN_SPEC','oe_ga/2020/20201103__ga__general.csv',r'^U.S. Senate \(Special\)$','^Democrat','^Republican',dict(vc=['election_day_votes','advanced_votes','absentee_by_mail_votes','provisional_votes'],by='party')),
 ('IA',2006,'GOV','oe_ia/2006/20061107__ia__general__governor__county.csv','^Governor$','CULVER','NUSSLE',dict(cc='jurisdiction')),
 ('IA',2010,'GOV','oe_ia/2010/20101102__ia__general__governor__county.csv','^Governor$','Culver','Branstad',dict(cc='jurisdiction')),
 ('IA',2010,'SEN','oe_ia/2010/20101102__ia__general__us_senate__county.csv','^U.S. Senate$','Conlin','Grassley',dict(cc='jurisdiction')),
 ('IA',2014,'SEN','oe_ia/2014/20141104__ia__general__precinct.csv','^U.S. Senate$','Braley','Ernst',dict(drop_na_precinct=True)),
 ('IA',2014,'GOV','oe_ia/2014/20141104__ia__general__precinct.csv','^Governor$','Hatch','Branstad',dict(drop_na_precinct=True)),
 ('IA',2016,'SEN','oe_ia/2016/20161108__ia__general__senate__county.csv','^U.S. Senate$','Patty Judge','Grassley',{}),
 ('IA',2020,'SEN','oe_ia/2020/counties/20201103__ia__general__county.csv','^U.S. Senate$','Greenfield','Ernst',{}),
 ('MI',2006,'SEN','oe_mi/2006/20061107__mi__general__precinct.csv','^U.S. Senate$','Stabenow','Bouchard',{}),
 ('MI',2006,'GOV','oe_mi/2006/20061107__mi__general__precinct.csv','^Governor$','Granholm','Devos',{}),
 ('MI',2008,'SEN','oe_mi/2008/20081104__mi__general__precinct.csv','^U.S. Senate$','Levin','Hoogendyk',{}),
 ('MI',2010,'GOV','oe_mi/2010/20101102__mi__general__precinct.csv','^Governor$','Bernero','Snyder',{}),
 ('MI',2012,'SEN','oe_mi/2012/20121106__mi__general__precinct.csv','^U.S. Senate$','Stabenow','Hoekstra',{}),
 ('MI',2014,'SEN','oe_mi/2014/20141104__mi__general__precinct.csv','^U.S. Senate$','Gary Peters','Terri Lynn Land',{}),
 ('MI',2014,'GOV','oe_mi/2014/20141104__mi__general__precinct.csv','^Governor$','Schauer','Snyder',{}),
 ('OH',2006,'SEN','oe_oh/2006/20061107__OH__general__precinct.csv','^US Senate$','Sherrod Brown','DeWine',{}),
 ('OH',2006,'GOV','oe_oh/2006/20061107__OH__general__precinct.csv','^Governor','Strickland','Blackwell',{}),
 ('OH',2012,'SEN','oe_oh/2012/20121106__oh__general__senate.csv','^U.S. Senate$','Sherrod Brown','Mandel',{}),
 ('OH',2014,'GOV','oe_oh/2014/20141104__oh__general.csv','^Governor$','FitzGerald','Kasich',{}),
 ('OH',2016,'SEN','oe_oh/2016/20161108__oh__general.csv','^U.S. Senate$','Strickland','Portman',{}),
 ('TX',2006,'SEN','oe_tx/2006/20061107__tx__general__county.csv','^U.S. Senate$','Radnofsky','Hutchison',{}),
 ('TX',2006,'GOV','oe_tx/2006/20061107__tx__general__county.csv','^Governor$','Chris Bell','Rick Perry',{}),
 ('TX',2008,'SEN','oe_tx/2008/20081104__tx__general__county.csv','^U.S. Senate$','Noriega','Cornyn',{}),
 ('TX',2010,'GOV','oe_tx/2010/20101102__tx__general__county.csv','^Governor$','Bill White','Rick Perry',{}),
 ('TX',2012,'SEN','oe_tx/2012/20121106__tx__general__county.csv','^U.S. Senate$','Sadler','Cruz',{}),
 ('TX',2014,'SEN','oe_tx/2014/counties/20141104__tx__general__county.csv','^U.S. Senate$','Alameel','Cornyn',{}),
 ('TX',2014,'GOV','oe_tx/2014/counties/20141104__tx__general__county.csv','^Governor$','Wendy','Abbott',{}),
 ('TX',2020,'SEN','oe_tx/2020/20201103__tx__general__precinct.csv',r'^(U\.?S\.? Senat)','Hegar','Cornyn',{}),
]

OFFICIAL = {
 ('GA',2006,'GOV'):(811049,1229724), ('GA',2008,'SEN'):(1757393,1867097), ('GA',2010,'SEN'):(996516,1489904),
 ('GA',2010,'GOV'):(1107011,1365832), ('GA',2014,'SEN'):(1160811,1358088), ('GA',2014,'GOV'):(1144794,1345237),
 ('GA',2016,'SEN'):(1599726,2135806), ('GA',2020,'SEN'):(2374519,2462617),
 ('IA',2006,'GOV'):(569021,467425), ('IA',2010,'GOV'):(484798,592494), ('IA',2010,'SEN'):(371686,718215),
 ('IA',2014,'SEN'):(494370,588575), ('IA',2014,'GOV'):(420787,666032), ('IA',2016,'SEN'):(549460,926007),
 ('IA',2020,'SEN'):(754859,864997),
 ('MI',2006,'SEN'):(2151278,1559597), ('MI',2006,'GOV'):(2142513,1608086), ('MI',2008,'SEN'):(3038386,1641070),
 ('MI',2010,'GOV'):(1287320,1874834), ('MI',2012,'SEN'):(2735826,1767386), ('MI',2014,'SEN'):(1704936,1290199),
 ('MI',2014,'GOV'):(1479057,1607399), ('MI',2020,'SEN'):(2734568,2642233),
 ('OH',2006,'SEN'):(2257369,1761037), ('OH',2006,'GOV'):(2435384,1474285), ('OH',2010,'SEN'):(1503297,2168742),
 ('OH',2010,'GOV'):(1812059,1889186), ('OH',2012,'SEN'):(2762766,2435744), ('OH',2014,'GOV'):(1009359,1944848),
 ('OH',2016,'SEN'):(1996908,3118567),
 ('TX',2006,'SEN'):(1555202,2661789), ('TX',2006,'GOV'):(1310337,1716792), ('TX',2008,'SEN'):(3389365,4337469),
 ('TX',2010,'GOV'):(2106395,2737481), ('TX',2012,'SEN'):(3194927,4440137), ('TX',2014,'SEN'):(1597387,2861531),
 ('TX',2014,'GOV'):(1835596,2796547), ('TX',2020,'SEN'):(4888764,5962983),
}

def oh2010(dcol, rcol):
    d = pd.read_csv(R + 'oe_oh/2010/2010_general_precinct.txt', sep='\t', dtype=str, encoding='latin-1')
    d = d[d['COUNTY NAME'].notna() & d.PRECINCT_CODE.notna() & (d.PRECINCT_CODE != 'ZZZ')]
    d = d.assign(k=d['COUNTY NAME'].map(norm))
    d = d[~d.k.str.contains('total')]
    D = votes_of(d, dcol).groupby(d.k).sum()
    Rr = votes_of(d, rcol).groupby(d.k).sum()
    return D, Rr

def mi2020():
    import glob
    Ds, Rs = {}, {}
    files = sorted(glob.glob(R + 'oe_mi/2020/counties/20201103__mi__general__*__precinct.csv'))
    for f in files:
        d = pd.read_csv(f, dtype=str, low_memory=False)
        o = d.office.fillna('')
        d = d[o.str.contains('Senat', case=False) & ~o.str.contains('State Senat', case=False)]
        if not len(d): continue
        d = d[~d.precinct.fillna('').str.lower().str.contains('total')]
        txt = d.candidate.fillna('') + ' ' + d.party.fillna('')
        v = votes_of(d, 'votes')
        k = norm(re.search(r'general__(.+)__precinct', f).group(1).replace('_', ' '))
        Ds[k] = v[txt.str.contains('Peters')].sum(); Rs[k] = v[txt.str.contains('John James')].sum()
    # fill counties lacking per-county senate data from the statewide precinct file
    d = load('oe_mi/2020/20201103__mi__general__precinct.csv')
    d = d[d.office.fillna('').str.contains('U.S. Senate')]
    d = d[~d.precinct.fillna('').str.lower().str.contains('total')]
    d = d.assign(k=d.county.map(norm), v=votes_of(d, 'votes'))
    txt = d.candidate.fillna('') + ' ' + d.party.fillna('')
    pD = d[txt.str.contains('Peters')].groupby('k').v.sum(); pR = d[txt.str.contains('John James')].groupby('k').v.sum()
    filled = []
    for k in FIPS['MI']:
        if k not in Ds and k in pD.index:
            Ds[k] = pD[k]; Rs[k] = pR[k]; filled.append(k)
    print('MI2020 filled from statewide precinct file:', filled)
    return pd.Series(Ds), pd.Series(Rs)

def extra(name):
    return {'OH2010SEN': lambda: oh2010('U.S. Senate - Fisher, Lee', 'U.S. Senate - Portman, Rob'),
            'OH2010GOV': lambda: oh2010('Governor/Lieutenant Governor - Strickland, Ted', 'Governor/Lieutenant Governor - Kasich, John'),
            'MI2020SEN': mi2020}[name]()

rows, report, dropped = [], [], []
def add(st, yr, race, D, Rr):
    fm = FIPS[st]
    keys = set(D.index) | set(Rr.index)
    unmapped = [k for k in keys if k not in fm]
    mapped = {fm[k] for k in keys if k in fm}
    missing = set(fm.values()) - mapped
    Dt, Rt = D.sum(), Rr.sum()
    off = OFFICIAL.get((st, yr, race))
    msg = ''
    ok = True
    if unmapped: msg += f' unmapped={unmapped}'; ok = False
    if missing: msg += f' missing_fips={len(missing)}'; ok = False
    if off:
        ed, er = (Dt - off[0]) / off[0], (Rt - off[1]) / off[1]
        msg += f' errD={ed:+.4f} errR={er:+.4f}'
        if abs(ed) > 0.015 or abs(er) > 0.015: ok = False
    print(st, yr, race, int(Dt), int(Rt), len(mapped), 'OK' if ok else 'FAIL', msg)
    if ok:
        for k in keys:
            rows.append((st, yr, race, fm[k], int(D.get(k, 0)), int(Rr.get(k, 0))))
        report.append((st, yr, race, int(Dt), int(Rt), len(mapped)))
    else:
        dropped.append((st, yr, race, msg))

only = sys.argv[1:]
for st, yr, race, f, o, dre, rre, kw in RACES:
    if only and f'{st}{yr}{race}' not in only: continue
    D, Rr = extract(st, f, o, dre, rre, **kw)
    add(st, yr, race, D, Rr)
for nm in ['OH2010SEN', 'OH2010GOV', 'MI2020SEN']:
    if not only or nm in only:
        add(nm[:2], int(nm[2:6]), nm[6:], *extra(nm))

if not only:
    out = pd.DataFrame(rows, columns=['state','year','race','county_fips','D','R']).sort_values(['state','year','race','county_fips'])
    out.to_csv('/home/claude/build/oe_hwm.csv', index=False)
    print('wrote', len(out))
    print('DROPPED:', dropped)
