"""Rebuild the districts redrawn in 2025 (TX-15, TX-23, OH-7) on their 2026 county lists.

The county lists come from civicAPI's 2026 general-election races (region_results), checked against the
March 2026 Texas primary results. Counties wholly inside the district use the county's statewide baseline.
Split counties use the county part from the 2024 lines (the closest available proxy); the March 2026
primary shows the TX-23 parts of Bexar (~22%) and El Paso (~8%) match the 2024 parts closely.
Run after build_model.py.
"""
import json, math

P = 'data/model/model.json'
m = json.load(open(P))

NEW = {
    # fips list from civicAPI race 87422 (TX-15), 87428 (TX-23), 87356 (OH-7)
    'TX-15': {'fips': ['48007', '48025', '48047', '48123', '48175', '48177', '48215', '48249', '48285', '48391', '48409'],
              'split': ['48215'],   # Hidalgo is shared with TX-28 and TX-34
              'note': 'Redrawn in 2025: now runs from Hidalgo north through the Coastal Bend (Aransas, Bee, Refugio, San Patricio, Goliad, DeWitt, Gonzales, Lavaca); Guadalupe, Wilson and Karnes moved out. Whole counties use their county baselines; the Hidalgo part uses its 2024-lines part as a proxy.'},
    'TX-23': {'fips': ['48029', '48043', '48103', '48105', '48109', '48137', '48141', '48163', '48229', '48243', '48271', '48301', '48323', '48325', '48371', '48377', '48383', '48389', '48413', '48435', '48443', '48461', '48463', '48465', '48475', '48495', '48507'],
              'split': ['48029', '48141'],   # Bexar, El Paso
              'note': 'Redrawn in 2025 (27 counties). Whole counties use their county baselines; the Bexar and El Paso parts use their 2024-lines parts, which the March 2026 primary shows are about the same size (Bexar ~22% of the county, El Paso ~8%).'},
    'OH-07': {'fips': ['39005', '39035', '39103', '39169'],
              'split': ['39035'],   # Cuyahoga
              'note': 'Redrawn in 2025: adds Ashland County, drops the Holmes sliver. Ashland, Medina and Wayne are whole counties; the Cuyahoga part uses its 2024-lines part as a proxy.'},
}

sig = lambda x: 1 / (1 + math.exp(-x))

def solve(cs, target=0.5):
    lo, hi = -5, 5
    for _ in range(80):
        mid = (lo + hi) / 2
        v = sum(c['w'] * sig(c['b'] + mid) for c in cs) / sum(c['w'] for c in cs)
        lo, hi = (mid, hi) if v < target else (lo, mid)
    return (lo + hi) / 2

for cd, spec in NEW.items():
    old = m['geos'][cd]
    st = m['geos'][old['state']]
    by_state = {c['fips']: c for c in st['counties']}
    by_old = {c['fips']: c for c in old['counties']}
    # the old build shifted every part so the district matched a published new-line margin; undo that shift
    NEWM = {'TX-23': 14.8, 'OH-07': 11.0, 'TX-15': 17.8}
    od = sum(next((x['d'] for x in c['hist'] if x['k'] == '2024-PRES'), 0) for c in old['counties'])
    orr = sum(next((x['r'] for x in c['hist'] if x['k'] == '2024-PRES'), 0) for c in old['counties'])
    lg = lambda p: math.log(p / (1 - p))
    old['calib_shift'] = lg((100 - NEWM[cd]) / 200) - lg(od / (od + orr)) if 'calib_shift' not in old else old['calib_shift']
    out = []
    for f in spec['fips']:
        sc = by_state[f]
        if f in spec['split'] and f in by_old:
            c = dict(by_old[f]); c['split'] = True
            # undo the old district-level calibration so parts and whole counties share one scale
            c['b'] = c['b'] - old.get('calib_shift', 0.0)
        elif f in spec['split']:
            raise SystemExit(f'{cd}: split county {f} has no 2024-lines part')
        else:
            c = {'fips': f, 'name': sc['name'], 'b': sc['b'], 'w': sc['w'], 'split': False, 'part_share_of_county': 1.0,
                 'hist': sc['hist'], 'county_hist': sc['hist'], 'hwm': sc['hwm'], 'hwm16': sc.get('hwm16')}
        out.append(c)
    # 2024 presidential share on the new lines, from county / part results
    d = r = 0
    for c in out:
        h = next((x for x in c['hist'] if x['k'] == '2024-PRES'), None)
        if h: d += h['d']; r += h['r']
    share24 = d / (d + r)
    old['counties'] = out
    old['lines_note'] = spec['note']
    old['pres24_new_lines'] = round(share24, 4)
    W = sum(c['w'] for c in out)
    old['baseline_share'] = round(sum(c['w'] * sig(c['b']) for c in out) / W, 4)
    old['swing_to_win'] = round(solve(out), 4)
    print(f"{cd}: {len(out)} counties, 2024 pres D two-party on new lines {share24:.3f} (R+{(1-2*share24)*100:.1f}), "
          f"expected 2-party vote {W:,}, swing {old['swing_to_win']}")

json.dump(m, open(P, 'w'), separators=(',', ':'))
