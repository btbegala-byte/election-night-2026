"""Add county types, early-vote skew and the Ohio Brown-2024 alternate baseline to data/model/model.json.
Run after build_model.py and redraw_cds.py.

County type (stratum), per state, computed from the model itself:
  size  = 'big' if the county is among the largest counties that together hold half the expected vote
  lean  = 'blue' if its baseline lean b is above the state's vote-weighted median b
  TX only: among counties that aren't 'big', the third with the biggest 2020->2024 presidential swing toward the GOP are 'realigning'
           (a stand-in for heavily Latino counties; no Census data needed)
District county parts inherit their county's statewide type and skew.
"""
import json, math

P = 'data/model/model.json'
m = json.load(open(P))
skew = json.load(open('tools/county-model/mode_skew.json'))
lg = lambda p: math.log(p / (1 - p))
LABEL = {'big-blue': 'Big, Dem-leaning', 'big-red': 'Big, GOP-leaning', 'small-blue': 'Small, Dem-leaning',
         'small-red': 'Small, GOP-leaning', 'realigning': 'Realigning (2020→24 GOP swing)'}

def h(c, k):
    x = next((e for e in c.get('county_hist') or c['hist'] if e['k'] == k), None)
    return x['d'] / (x['d'] + x['r']) if x else None

strata = {}
for st in ['GA', 'IA', 'MI', 'NC', 'OH', 'TX']:
    cs = m['geos'][st]['counties']
    W = sum(c['w'] for c in cs)
    acc = 0; big = set()
    for c in sorted(cs, key=lambda c: -c['w']):
        if acc < W / 2: big.add(c['fips'])
        acc += c['w']
    acc = 0; bmed = None
    for c in sorted(cs, key=lambda c: c['b']):
        acc += c['w']
        if acc >= W / 2: bmed = c['b']; break
    realign = set()
    if st == 'TX':
        sw = []
        for c in cs:
            a, b = h(c, '2020-PRES'), h(c, '2024-PRES')
            if a and b and c['fips'] not in big: sw.append((lg(a) - lg(b), c['fips']))   # positive = moved toward GOP; big metros keep their own types
        sw.sort(reverse=True)
        realign = {f for _, f in sw[:len(sw) // 3]}
    for c in cs:
        k = 'realigning' if c['fips'] in realign else f"{'big' if c['fips'] in big else 'small'}-{'blue' if c['b'] > bmed else 'red'}"
        c['stratum'] = k
        sk = skew.get(st, {}).get('counties', {}).get(c['fips'])
        if sk and 'early_delta' in sk:
            c['early_delta'] = sk['early_delta']; c['eday_delta'] = sk.get('eday_delta'); c['early_share22'] = sk.get('early_share_of_votes')
        strata[c['fips']] = c
    m['geos'][st]['strata_labels'] = LABEL
    m['geos'][st]['skew_source'] = '2022 Senate vote-mode rows (MIT precinct file)' if st in skew else None
    cnt = {}
    for c in cs: cnt[c['stratum']] = cnt.get(c['stratum'], 0) + 1
    print(st, cnt)

# district parts inherit their county's type and skew
for gid, g in m['geos'].items():
    if g['type'] != 'cd': continue
    for c in g['counties']:
        sc = strata[c['fips']]
        c['stratum'] = sc['stratum']
        for k in ('early_delta', 'eday_delta', 'early_share22'):
            if k in sc: c[k] = sc[k]
    g['strata_labels'] = LABEL

# Ohio Senate alternate baseline: 60% 2024 presidential + 40% Brown's own 2024 Senate map
oh = m['geos']['OH']
for c in oh['counties']:
    p24, b24 = h(c, '2024-PRES'), h(c, '2024-SEN')
    c['b_alt'] = round(0.6 * lg(p24) + 0.4 * lg(b24), 5)
oh['alt_label'] = {'SEN': 'Brown-2024 pace'}
json.dump(m, open(P, 'w'), separators=(',', ':'))
print('ok')
