"""Early-vote vs. Election Day skew by county, from MIT 2022 precinct rows that carry vote mode.

For GA, NC and IA (the states whose 2022 files split votes by mode), computes for the 2022 Senate race:
  early_delta = logit(D share of early+mail votes) - logit(D share of all votes)
  eday_delta  = logit(D share of Election Day votes) - logit(D share of all votes)
Positive early_delta = early votes more Democratic than the county's full count.
Counties with fewer than 300 early or Election Day votes use the state value.
Output: tools/county-model/mode_skew.json  {state: {"state": {...}, "counties": {fips: {...}}}}
TX and OH files report totals only; MI's 2022 mode data is partial, so those states get no skew table.
"""
import pandas as pd, numpy as np, json

RAW = '/home/claude/data/raw/m22/'
FILES = {'GA': 'ga22_cleaned.csv', 'NC': 'NC-cleaned-final3.csv', 'IA': 'IA_cleaned.csv'}
EARLY = {'GA': {'ADVANCED', 'ABSENTEE'}, 'NC': {'ONE STOP', 'ABSENTEE BY MAIL'}, 'IA': {'ABSENTEE'}}
EDAY = {'GA': {'ELECTION DAY'}, 'NC': {'ELECTION DAY'}, 'IA': {'ELECTION DAY'}}
lg = lambda p: np.log(p / (1 - p))
out = {}
for st, f in FILES.items():
    df = pd.read_csv(RAW + f, usecols=['office', 'mode', 'party_simplified', 'votes', 'county_fips', 'stage', 'special'], dtype=str, low_memory=False)
    df = df[(df.office.str.upper() == 'US SENATE') & (df.stage.fillna('GEN').str.upper() == 'GEN') & (df.special.fillna('FALSE').str.upper() != 'TRUE')]
    df = df[df['mode'].str.upper() != 'TOTAL']
    df['votes'] = pd.to_numeric(df.votes, errors='coerce').fillna(0)
    df['county_fips'] = df.county_fips.str.replace(r'\.0$', '', regex=True).str.zfill(5)
    df['p'] = df.party_simplified.str.upper().map({'DEMOCRAT': 'D', 'REPUBLICAN': 'R'})
    df = df[df.p.notna()]
    m = df['mode'].str.upper()
    df['phase'] = np.where(m.isin(EARLY[st]), 'early', np.where(m.isin(EDAY[st]), 'eday', 'other'))
    g = df.pivot_table(index=['county_fips', 'phase'], columns='p', values='votes', aggfunc='sum', fill_value=0)
    tot = df.pivot_table(index='county_fips', columns='p', values='votes', aggfunc='sum', fill_value=0)

    def deltas(gg, tt):
        e = gg.get('early', None); d = gg.get('eday', None)
        ts = tt['D'] / (tt['D'] + tt['R'])
        res = {'early_share_of_votes': None}
        if e is not None and (e['D'] + e['R']) > 0:
            res['early_delta'] = float(lg(e['D'] / (e['D'] + e['R'])) - lg(ts))
            res['early_share_of_votes'] = float((e['D'] + e['R']) / (tt['D'] + tt['R']))
            res['n_early'] = int(e['D'] + e['R'])
        if d is not None and (d['D'] + d['R']) > 0:
            res['eday_delta'] = float(lg(d['D'] / (d['D'] + d['R'])) - lg(ts))
            res['n_eday'] = int(d['D'] + d['R'])
        return res

    sg = df.pivot_table(index='phase', columns='p', values='votes', aggfunc='sum', fill_value=0)
    st_tot = sg.sum()
    state_res = deltas({ph: sg.loc[ph] for ph in sg.index}, st_tot)
    counties = {}
    for fips in tot.index:
        sub = {ph: g.loc[(fips, ph)] for ph in ('early', 'eday') if (fips, ph) in g.index}
        r = deltas(sub, tot.loc[fips])
        if r.get('n_early', 0) < 300 or r.get('n_eday', 0) < 300:
            r = {**state_res, 'fallback': True, 'early_share_of_votes': r.get('early_share_of_votes')}
        counties[fips] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()}
    out[st] = {'state': {k: (round(v, 4) if isinstance(v, float) else v) for k, v in state_res.items()}, 'counties': counties}
    print(st, 'state early_delta %.3f eday_delta %.3f early share %.2f' % (state_res['early_delta'], state_res['eday_delta'], state_res['early_share_of_votes']),
          '| counties', len(counties), '| fallback', sum(1 for c in counties.values() if c.get('fallback')))
json.dump(out, open('tools/county-model/mode_skew.json', 'w'))
