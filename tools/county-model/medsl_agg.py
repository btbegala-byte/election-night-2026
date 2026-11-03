# Aggregate MEDSL precinct files -> county and CD-county-part totals for top races.
import pandas as pd, glob, sys, os, re
FILES = {
 2018: {s: f'm18/2018-{s.lower()}-precinct-general.csv' for s in ['GA','IA','MI','NC','OH','TX']},
 2022: {'GA':'m22/ga22_cleaned.csv','IA':'m22/IA_cleaned.csv','MI':'m22/mi22_cleaned.csv','NC':'m22/NC-cleaned-final3.csv','OH':'m22/oh22_cleaned.csv','TX':'m22/TX-cleaned.csv'},
 2024: {s: f'm24/{s.lower()}24.csv' for s in ['GA','IA','MI','NC','OH','TX']},
}
COLS=['precinct','office','party_simplified','mode','votes','county_fips','candidate','district','stage','special']
def norm_office(o):
    o=str(o).upper()
    if o=='US PRESIDENT': return 'PRES'
    if o=='US SENATE': return 'SEN'
    if o=='US HOUSE': return 'HOUSE'
    if 'GOVERNOR' in o and 'BOARD' not in o and not o.startswith('LIEUTENANT') and not o.startswith('LT'): return 'GOV'
    return None
out_c=[]; out_cd=[]
for yr, d in FILES.items():
    for st, f in d.items():
        f=os.path.join('/home/claude/data/raw',f)
        parts=[]
        for ch in pd.read_csv(f,usecols=lambda c: c in COLS,dtype=str,chunksize=2_000_000,low_memory=False):
            ch['race']=ch.office.map(norm_office)
            ch=ch[ch.race.notna()]
            if 'stage' in ch: ch=ch[ch.stage.fillna('GEN').str.upper().isin(['GEN'])]
            parts.append(ch)
        df=pd.concat(parts)
        df['votes']=pd.to_numeric(df.votes,errors='coerce').fillna(0)
        df['county_fips']=df.county_fips.str.replace(r'\.0$','',regex=True).str.zfill(5)
        df['mode']=df['mode'].fillna('TOTAL').str.upper()
        # avoid double counting: where a precinct/race has TOTAL rows keep only them
        key=['county_fips','precinct','race','district']
        df['district']=df.district.fillna(''); df['precinct']=df.precinct.fillna('NA')
        ht=df.assign(t=df['mode'].eq('TOTAL')).groupby(key)['t'].transform('any').astype(bool)
        df=df[~ht | df['mode'].eq('TOTAL')]
        sp=df.special.fillna('FALSE').str.upper().eq('TRUE') if 'special' in df else False
        df['race']=df.race.where(~sp, df.race+'_SPEC')
        df['p']=df.party_simplified.fillna('').str.upper().map({'DEMOCRAT':'D','REPUBLICAN':'R'}).fillna('O')
        # county-level
        c=df[df.race!='HOUSE'].pivot_table(index=['county_fips','race'],columns='p',values='votes',aggfunc='sum',fill_value=0).reset_index()
        c['year']=yr; c['state']=st; out_c.append(c)
        # precinct -> house district (max house votes)
        h=df[df.race=='HOUSE']
        if len(h):
            h=h.assign(dn=pd.to_numeric(h.district,errors='coerce'))
            pm=h.groupby(['county_fips','precinct','dn']).votes.sum().reset_index().sort_values('votes').drop_duplicates(['county_fips','precinct'],keep='last')[['county_fips','precinct','dn']]
            j=df.merge(pm,on=['county_fips','precinct'],how='inner')
            j=j[(j.race!='HOUSE') | (pd.to_numeric(j.district,errors='coerce')==j.dn)]
            cd=j.pivot_table(index=['dn','county_fips','race'],columns='p',values='votes',aggfunc='sum',fill_value=0).reset_index()
            cd['year']=yr; cd['state']=st; out_cd.append(cd)
        print(yr,st,len(df),sorted(df.race.unique()),flush=True)
C=pd.concat(out_c); CD=pd.concat(out_cd)
for x in (C,CD):
    for p in 'DRO':
        if p not in x: x[p]=0
C.to_csv('/home/claude/build/medsl_county.csv',index=False); CD.to_csv('/home/claude/build/medsl_cdpart.csv',index=False)
