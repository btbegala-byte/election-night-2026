# County Targets win model: how it was built

This document covers what the County Targets maps compute, where every number comes from, and which assumptions to check. The code lives in this repo. `tools/county-model/` builds the historical model. `county/engine.js` does all the election-night math, and the page, the AI notes, the race snapshots and the chat all read from it.

The last section, "Where to push on this," lists the assumptions most likely to be wrong.

---

## 1. What the model answers

For every county (or county part, for House districts), the model answers one question: **what two-party Democratic share does this county need for the Democrat to win the state or district?** That number is the county's **win pace**.

On election night, each county's live result is compared with its win pace. The page then:

- rates each county as ahead of, on, or behind win pace;
- turns the gap into net votes;
- projects the final margin by applying each county's gap to its uncounted vote.

Everything is in **two-party share**: Dem / (Dem + GOP). Third parties and write-ins are ignored in the math. They show up only as a displayed share when a non-major candidate passes 5%.

Geographies: statewide in GA, IA, MI, NC, OH and TX (Senate and governor where on the ballot; NC has Senate only), plus IA-1, IA-2, MI-4, MI-10, NC-5, NC-11, OH-7, TX-15 and TX-23.

---

## 2. Data sources

| Data | Source | Used for |
|---|---|---|
| County presidential results 2008, 2012, 2016, 2020, 2024 | `tonmcg/US_County_Level_Election_Results_08-24` on GitHub (compiled from official results) | 2024 baseline; history; high-water marks |
| Precinct returns 2018, 2022, 2024 (all six states) | MIT Election Data + Science Lab, `MEDSL/2018-elections-official` (master), `2022-elections-official`, `2024-elections-official` | 2018/2022/2024 Senate and governor by county; every county *part* inside a House district |
| Senate and governor county results 2006–2020 | OpenElections state repos (`openelections-data-ga`, `-ia`, `-mi`, `-oh`, `-tx`) | High-water marks only |
| County shapes | `us-atlas` 10m counties (Census cartographic boundaries) | Map drawing only |
| 2024 presidential margin on the 2026 district lines | 270toWin (citing Dave's Redistricting) | Calibrating TX-15, TX-23, OH-7 |
| Live results | civicAPI (`civicapi.org/api/v2/race/{id}`), county breakdown in `region_results` | Election night |

### 2.1 Processing the MIT precinct files (`tools/county-model/medsl_agg.py`)

- **Offices kept:** `US PRESIDENT`, `US SENATE`, `US HOUSE`, and any office containing "GOVERNOR". Lieutenant governor and university "Board of Governors" races are excluded. Special elections are tagged separately and kept out of the regular races.
- **Stage:** general elections only (`stage == GEN`).
- **Avoiding double counting:** some files report vote modes (early, mail, Election Day) *and* a `TOTAL` row. For each precinct and race, if a `TOTAL` row exists, only `TOTAL` is kept; otherwise the modes are summed.
- **Party:** `DEMOCRAT` → D, `REPUBLICAN` → R, everything else → other.
- **County parts of House districts:** each precinct is assigned to the House district that got the most House votes in that precinct. Every other race in the precinct (president, Senate, governor) then rolls up to that district-by-county part. A precinct with no House rows drops out of the district parts. That can't happen in our nine districts because all nine races were contested in 2022 and 2024.

### 2.2 Validation of the processed data

Statewide sums from the processed county files against official results:

| Race | Processed D / R | Check |
|---|---|---|
| GA 2024 Pres | 2,548,006 / 2,663,110 | Official 2,548,017 / 2,663,117 |
| GA 2022 Sen | 1,946,117 / 1,908,442 | Matches official general (Warnock / Walker) |
| OH 2022 Sen | 1,939,489 / 2,192,114 | Matches official (Ryan / Vance) |
| TX 2024 Sen | 5,031,142 / 5,990,637 | Matches official (Allred / Cruz) |
| MI 2022 Gov | 2,403,861 / 1,952,318 | **About 1.1% short of official D (2,430,505).** A few precincts are missing in MIT's file; this is the one known gap |

House district parts were checked against the known 2024 results. IA-1 comes out at 49.9% D two-party (Miller-Meeks won by about 800 votes). Also checked: TX-15 at about 43–57, TX-23 at about 38–62, OH-7 at 41.4% D. All match.

The OpenElections 2006–2020 files were parsed by a separate script (`build_oe_hwm.py`). Every race kept covers every county in its state and sums to within 0.3% of official statewide totals. Races I dropped and why:
- **TX 2020 Senate:** 8 counties missing, including Fort Bend and Nueces.
- **IA 2008 Senate:** only 83 of 99 counties.
- **NC, all years:** no usable OpenElections files.
- **GA 2020 special Senate:** a jungle primary with no nominees, so excluded.

---

## 3. Building each county's baseline (`tools/county-model/build_model.py`)

### 3.1 Lean (statewide geographies)

Each county gets a baseline lean `b`, in log-odds of the two-party Dem share:

```
b = 0.6 × logit(2024 presidential D share) + 0.4 × logit(2022 midterm D share)
```

where `logit(p) = ln(p / (1 − p))`.

The 2022 component uses these races. When two are listed, their log-odds are averaged first.

| State | 2022 race(s) used | Why |
|---|---|---|
| GA | Senate (Warnock) + Governor (Abrams) | Two very different Dem performances; averaging dampens either one's candidate effects |
| IA | Senate (Franken) + Governor (DeJear) | Same |
| MI | Governor (Whitmer) | Only statewide top-of-ticket race in 2022 |
| NC | Senate (Beasley) | Only statewide top-of-ticket race in 2022 |
| OH | Senate (Ryan) only | DeWine's 25-point governor win would badly distort county shape |
| TX | Governor (O'Rourke) | Only statewide top-of-ticket race in 2022 |

**Why blend at all:** 2024 reflects the current coalition, including the Latino and young-voter shifts. 2022 reflects a midterm electorate. The 60/40 weighting is a judgment call, not fitted to data (see section 7).

**Why log-odds:** a uniform shift in log-odds moves a 50/50 county more points than a 20/80 county. That matches how counties actually swing better than a flat point shift does, and it keeps every target between 0% and 100%.

### 3.2 Expected vote

```
w = 2022 two-party votes in the county
```

When two 2022 races are used (GA, IA), `w` is their average. This is the expected 2026 turnout before any results come in. On election night it gets re-estimated (section 5.2).

### 3.3 Win pace: the uniform swing

The model finds one shift `s`, the same for every county in the geography, so that:

```
Σ w_i × σ(b_i + s)  /  Σ w_i  =  target
```

where `σ(x) = 1 / (1 + e^(−x))`. The target defaults to 50.0% and moves with the slider on the page. It's solved by bisection.

Each county's **win pace** is `t_i = σ(b_i + s)`. Its **full-count target margin** is `(2t_i − 1) × w_i` votes.

Size of the shift needed for a bare win (in log-odds; 0.1 is about 2.5 points in a 50/50 county):

| Geography | Shift | Weighted baseline D share |
|---|---|---|
| MI | −0.068 | 51.6% (Whitmer's 2022 blowout pulls the blend above 50%) |
| GA | +0.047 | 49.0% |
| NC | +0.065 | 48.5% |
| OH | +0.201 | 45.4% |
| TX | +0.282 | 43.8% |
| IA | +0.308 | 42.9% |

The baseline *level* doesn't matter, because the shift absorbs it. What matters is each county's lean *relative to* the others.

### 3.4 What the targets look like (largest counties)

| County | Win pace | Harris 2024 | Notes |
|---|---|---|---|
| Fulton, GA | 73.4% | 72.7% | Warnock 2022: 75.0% |
| Gwinnett, GA | 59.3% | 58.4% | |
| Wake, NC | 64.8% | 63.0% | |
| Mecklenburg, NC | 68.1% | 66.7% | |
| Oakland, MI | 56.3% | 55.4% | |
| Wayne, MI | 66.3% | 65.0% | |
| Macomb, MI | 45.2% | 43.0% | Whitmer 2022: 52.6% |
| Franklin, OH | 69.5% | 64.3% | Brown 2018: 68.7% |
| Cuyahoga, OH | 71.0% | 65.9% | |
| Polk, IA | 62.8% | 55.5% | Above Hubbell 2018 (59.3%) |
| Harris, TX | 60.5% | 52.8% | Above O'Rourke 2018 (58.4%) |
| Hidalgo, TX (TX-15 part) | 59.4% | 48.1% | |

The pattern to notice: in IA, OH and TX, a win requires many counties to beat their best Dem showing of the last decade. That isn't a bug, just the size of the gap. It does mean the targets in those states are a statement about *how* a win would have to happen (spread evenly), not just *whether* it can.

### 3.5 House districts

- **County parts:** the baseline uses the part of each county inside the district, built from precinct data on the **2024 district lines**.
- **Blend:** for IA, MI, TX and OH, the 2022 and 2024 elections used the same lines, so the same 60/40 blend applies, using the part's 2022 results. `w` is the part's 2022 two-party vote.
- **North Carolina:** NC-5 and NC-11 were redrawn between 2022 and 2024. The baseline is therefore 2024 presidential only. `w` is the part's 2024 presidential two-party vote times NC's statewide ratio of 2022 Senate votes to 2024 presidential votes (about 0.66).
- **2025 redraws (TX-15, TX-23, OH-7):** these districts are rebuilt on their **2026 county lists** by `redraw_cds.py`. The county lists are taken from civicAPI's 2026 general-election races.
  - **Whole counties** use the county's own statewide baseline.
  - **Split counties** use the county part from the 2024 lines as a proxy: Hidalgo for TX-15, Bexar and El Paso for TX-23, Cuyahoga for OH-7.
  - **TX-15 changed a lot.** It now runs from Hidalgo up through the Coastal Bend (Aransas, Bee, Refugio, San Patricio, Goliad, DeWitt, Gonzales, Lavaca, Brooks, Jim Wells). Guadalupe, Wilson and Karnes left.
  - **OH-7** gained Ashland County and lost its Holmes sliver.
  - **TX-23 parts:** the March 2026 primary shows the Bexar part (about 22% of the county) and the El Paso part (about 8%) are close to their 2024 size.
  - **Check against DRA:** on the new lines, this build gives a 2024 presidential margin of R+20.3 for TX-15, R+15.9 for TX-23 and R+12.8 for OH-7. 270toWin/DRA's new-line figures are R+17.8, R+14.8 and R+11.0. The 1–2.5 point gap most likely means the real split-county parts lean more Democratic than the 2024-lines proxies, above all the Hidalgo part of TX-15. That gap moves those parts' targets relative to the other counties. It doesn't change the district target, which is always solved to 50%.
- **Split counties:** a county counts as split when its in-district part had under 98% of its 2024 presidential vote. Split counties are hatched on the map. Their history rows show the *part*, but their high-water marks are *whole-county*, and the page says so. The split counties are:
  - MI-4: Berrien, Calhoun, Kalamazoo, Ottawa
  - MI-10: Macomb (75%), Oakland (7%)
  - NC-5: Guilford
  - NC-11: Polk
  - OH-7: Cuyahoga (44%)
  - TX-15: Hidalgo (67%)
  - TX-23: Bexar (23%), El Paso (8%)
- **The House target** is the House race at 50% two-party in the district. The presidential and midterm baselines set the *shape* of the targets, and the shift sets the *level*.

### 3.6 High-water marks

- **"Best since 2006"** is the highest Dem two-party share the county gave any presidential nominee (2008–2024) or any Senate or governor nominee (2006–2024, where data exists) in a general election.
- **"Best since 2016"** is the same thing restricted to 2016 onward.
- **Excluded:** TX 2006 governor (a four-way race where two-party share is meaningless) and GA 2020 special Senate.
- **Coverage gaps:**
  - NC has no Senate or governor results before 2022, apart from presidential races.
  - TX has no 2020 Senate.
  - IA has no 2008 Senate.
- **Why there are two:** "Best since 2006" is dominated by old-coalition races. Levin 2008 is the best in 75 of 83 Michigan counties, Strickland 2006 in 86 of 88 Ohio counties, and Bill White 2010 in 147 of 254 Texas counties. That's accurate, but it isn't a realistic bar for a 2026 Democrat, which is why "since 2016" sits next to it.

---

## 4. Live results

- The dashboard pulls each race from civicAPI. `county/civic.js` maps each region in `region_results` to a county by its 5-digit FIPS code.
- Party labels are mapped: Democratic → D, Republican → R, Independent / no party → I, everything else → other.
- civicAPI's `percent_reporting` per county is read as the county's share of the vote counted. It's normalized to 0–100.
- civicAPI does **not** report vote type (early, mail, Election Day). The engine has logic for that breakdown, but it never triggers with civicAPI data; see section 7.

---

## 5. The live engine (`county/engine.js`)

### 5.1 Share counted (`f`) and expected total (`E`) per county

- Start with `f = min(0.99, V / E)`, where `V` is the two-party votes counted and `E = w × turnout factor`.
- When civicAPI gives a percent reporting `p` (as a fraction):
  - `f = min(0.99, 0.75·p + 0.25·f)`
  - When `p > 0.05`, the county's expected total is re-estimated as `E_eff = k·(V / p) + (1 − k)·E`, where `k = min(1, 1.5·p)`. Once a county is more than two-thirds counted, its own count drives its expected total.
- At 100% reporting, the county is complete: `f = 1` and `E = V`.

### 5.2 Turnout factor

The factor starts at 1.0, meaning 2026 turnout equals 2022. It switches to an estimate from the results once at least three counties are fully counted and those counties made up at least 8% of the expected vote:

```
turnout factor = (votes counted in complete counties) / (their 2022 votes)
```

The factor is held between 0.55 and 1.7 and scales `E` for every county that isn't complete. It does *not* change the win-pace shares, only the vote totals.

### 5.3 Rating each county

- `A` = live two-party Dem share, `t` = win pace, `dev = A − t`.
- **Tolerance band** (in share units):

  ```
  band = 0.012 + 0.07 × (1 − f)  [+ 0.03 if early/mail-only]  [+ 0.01 if split]
  ```

  At 20% counted the band is about ±6.8 points. At 90% counted it's about ±1.9 points.
- **Verdict:**
  - "too early" if `f < 3%`
  - **ahead** if `dev > band`
  - **behind** if `dev < −band`
  - **on pace** otherwise
- **Net votes vs. pace** = `2 × V × dev`: how far the county's current margin is from where it would be at exactly win pace, at the current count.

### 5.4 Projection and outlook

For each county still counting, the uncounted vote is `max(0, E − V)`. It's assumed to split at:
- **Counties reporting:** `t + dev × k`, where `k = 0.5 + 0.4·f` (`k = 0.3` if early/mail-only). The less that's counted, the more the county's gap is assumed to shrink back toward pace.
- **Counties not yet reporting:** `t + 0.6 × (vote-weighted average dev of reporting counties) × min(1, 4 × share counted statewide)`. Early on, unreported counties are assumed to sit at pace. As more vote comes in, the statewide pattern is applied to them at 60% strength.
- Shares are held between 3% and 97%.

The projected final share is the current votes plus those projected splits. The outlook compares the projected share minus 50% against an uncertainty of `0.006 + 0.06 × (1 − share counted)`:
- **On path to win:** projected share is above 50% by more than the uncertainty.
- **Off the win pace:** below 50% by more than the uncertainty.
- **Too close to call:** otherwise.

At 50% counted, the uncertainty is ±3.6 points of share, or about ±7 points of margin.

**These constants are heuristics, not fitted values.** See section 7.

---

## 6. AI layers (no math happens here)

- **County notes and state outlooks:** a GitHub job, on your Max token, runs about every 5–7 minutes. It sends Claude the engine's verdicts and numbers and asks it to explain them. The prompt forbids contradicting a verdict.
- **Race snapshots:** the same job writes one snapshot per state, plus an all-states one, whenever that state's vote totals change. Every snapshot is kept in `data/model/snapshots.json`.
- **Chat:** the chat sends Claude the same engine output for every geography, plus the dashboard totals.

---

## 7. Where to push on this

In rough order of how much each could mislead you tonight:

1. **The uniform swing is the biggest assumption.** In IA, OH and TX, the model spreads a 7–8 point needed gain evenly across counties, in log-odds. A real Dem win would likely be lopsided: some suburbs swinging hard, rural areas barely moving, Latino areas doing something different from both. When that happens, the statewide projection can still be right while individual counties read as "behind" or "ahead" for reasons that don't matter. Read the county verdicts as "relative to an even path," not "relative to the only path."

2. **The 60/40 blend and the 2022 races chosen.** Candidate effects ride along:
   - Whitmer's 2022 strength in Macomb and Wayne raises their MI targets (Macomb 45.2% vs. Harris 43.0%).
   - O'Rourke's 2022 Latino numbers raise border-county targets well above 2024 (Hidalgo 59.4% vs. Harris 48.1%). That assumes a partial reversal of the 2024 Latino shift.

   A 100% 2024 baseline would put these targets closer to 2024 levels. This is the easiest lever to change: `W_PRES24` and `W_MID22` in `build_model.py`, then rebuild.

3. **There is no early-vote correction in the math.** civicAPI gives no vote-type breakdown, so the early/mail-only flag never fires. In GA, NC, MI and OH, metro counties that report early and mail ballots first will look ahead of pace before Election Day votes land. The band is wide when little is counted, but it isn't directional. The AI notes and the chat are told about this; the math isn't. Be skeptical of "ahead of pace" in metro counties under about 50% counted.

4. **civicAPI's `percent_reporting` hasn't been checked against a live count.** If it measures precincts rather than expected vote, `f` and the per-county expected totals will be off early in the night. Precincts reporting runs ahead of vote counted when large precincts report late.

5. **Turnout assumes 2022.** Higher or differently distributed 2026 turnout shifts the vote totals and the projection's weights. It doesn't change the win-pace shares. The live turnout factor fixes the overall level once a few counties are complete, but not where in the state the turnout falls.

6. **The heuristic constants have not been backtested.** That covers the band, the 0.5–0.9 shrink, the 60% statewide carryover, and the uncertainty formula. The cleanest test would be to replay 2024 county results in counting order, for example the MI or TX Senate race, through `engine.js` with a model built without that race, and see whether the outlook called it correctly and when.

7. **District details:**
   - In the redrawn TX-15, TX-23 and OH-7, the split-county parts (Hidalgo, Bexar, El Paso, Cuyahoga) are 2024-lines proxies. In TX-15 this build runs about 2.5 points redder than DRA's new-line figure, so read the Hidalgo part's verdict loosely.
   - High-water marks for split counties are whole-county.
   - NC district baselines are 2024 presidential only.

8. **Two-party only.** If a third-party or independent candidate takes a real share, the win pace measures Dem vs. GOP, not who finishes first.

9. **Known data gaps:**
   - MI 2022 governor is about 1% short on D votes.
   - NC has no Senate or governor results before 2022.
   - TX has no 2020 Senate; IA has no 2008 Senate.

---

## 8. Rebuilding

```
python3 tools/county-model/medsl_agg.py      # precinct files → county and district-part totals
python3 tools/county-model/build_oe_hwm.py   # OpenElections 2006–2020 → high-water-mark races
python3 tools/county-model/build_model.py    # → data/model/model.json
python3 tools/county-model/redraw_cds.py     # rebuild TX-15, TX-23, OH-7 on 2026 county lists
python3 tools/county-model/mode_skew.py      # 2022 early-vote skew by county (GA, NC, IA)
python3 tools/county-model/add_strata.py     # county types, skew and the OH Brown-2024 pace → model.json
node    tools/county-model/geo.mjs           # county shapes → data/model/geo/*.json
```

The scripts expect the raw downloads in the paths noted at the top of each file. Model settings sit in constants near the top of `build_model.py`:
- `W_PRES24` / `W_MID22`: the blend weights
- `MID22`: the 2022 races used per state
- `NEWLINE_PRES24_MARGIN_R`: the new-line calibration
- `HWM_EXCLUDE`: races excluded from high-water marks

---

## 9. Election-day revisions (after the outside critique)

An outside review argued that the benchmark is sound but the live projection isn't: it pulls the uncounted vote toward a 50% tie, and it spreads one statewide average over every unreported county. I agree with both points. The changes below went in on Election Day. **All new projection math runs in shadow mode:** the original projection is still the headline number, and the new one appears next to it, labeled "alt model (v2, testing)."

### 9.1 Changes to the existing engine
- **Expected-vote guard.** The vote total implied by percent reporting (`V/p`) is now held within 0.6–1.8× of the expected vote, and never below the votes already counted.
- **"Likely early vote only" flag.** A county gets the flag when any of these holds:
  - civicAPI shows votes at under 1% reporting;
  - in GA, NC, OH and TX, it's within 45 minutes after polls close;
  - vote-type data says so. civicAPI doesn't provide that data today.

  Flagged counties are judged against a **pace for early votes**, `σ(b + s + early_delta)`, where the 2022 early-vote skew is known (GA, NC, IA; see 9.3). They also get a wider band. An "ahead" verdict on a flagged county shows as "Ahead (early votes only)" and stays out of the headline ahead count. Flagged counties are left out of the statewide average the original projection carries into unreported counties.
- **Impact.** Each county gets a projected full-count net-vote figure against pace: `2 × expected vote × (projected final share − pace)`. Counties under 1,000 projected net votes are grayed on the map. The "beating / trailing pace" lists are now ranked by projected net votes.
- **Turnout-adjusted win pace.** The win-pace shift is re-solved on every refresh using live expected-vote weights. When it differs from the fixed pace by half a point or more, the county detail shows it.
- **Swing vs. 2024** is its own column on the full map page.
- **Ohio Senate alternate benchmark.** A second pace built from 60% 2024 presidential and 40% Sherrod Brown's own 2024 Senate map. It appears as "Brown-2024 pace" in the county detail for the Ohio Senate race.

### 9.2 County types (`add_strata.py`)
Each state's counties are split into four types from the model itself, with no outside data:
- **Size:** "big" means the county is among the largest counties that together hold half the expected vote; everything else is "small."
- **Lean:** "Dem-leaning" or "GOP-leaning," depending on whether the county's baseline is above or below the state's vote-weighted median.

Texas adds a fifth type, **"realigning."** It's the third of non-big counties with the biggest 2020→2024 shift toward the GOP, and it stands in for heavily Latino counties. It's an imperfect stand-in: Lubbock and Brazos land in it too. House-district parts inherit their county's type.

**The observed-vs-needed panel.** For each type, the panel shows the shift fully counted counties actually delivered against their baseline. The shift is in log-odds, displayed as points at a 50/50 county, next to the shift the state needs. This answers the uniform-swing problem directly: in IA, OH and TX, small counties falling short of the needed shift is the expected shape of a Democratic win. What matters is whether the big counties beat it by enough.

### 9.3 Early-vote skew (`mode_skew.py`)
From MIT's 2022 Senate precinct rows that carry vote type, for each county:
- `early_delta = logit(D share of early + mail) − logit(D share of all votes)`
- `eday_delta = logit(D share of Election Day) − logit(D share of all votes)`

Statewide figures:

| State | early_delta | eday_delta | Early share of 2022 votes |
|---|---|---|---|
| GA | +0.19 | −0.34 | 64% |
| NC | +0.25 | −0.35 | 58% |
| IA | +0.64 | −0.29 | 30% |

Counties with fewer than 300 early or Election Day votes use the state figure. TX and OH files report totals only, and MI's 2022 vote-type data is partial, so those states get the flag and wider band but no skew correction.

### 9.4 The v2 projection (shadow)
All in log-odds:
1. **Each reporting county's observed shift** is `logit(live share) − b`. For flagged counties, the early skew is removed first. Each county is weighted by its votes counted; flagged counties count at 35%.
2. **The statewide shift** blends the counted counties with a prior of 0, meaning "the blended 2024/2022 baseline." The prior is weighted as if 5% of the expected vote were already in at it. The critique proposed 15%, but at that weight the prior still held about 18% of the weight with two-thirds counted, so it never really stopped mattering.
3. **Each county type's shift** is that type's counted counties, pulled toward the statewide shift as if 5% of the vote sat at the statewide figure.
4. **Unreported counties are projected at `b + their type's shift`.** Reporting counties keep 40–90% of their own gap from their type, depending on how much is counted. A flagged county's remaining vote is projected as Election Day votes, at `+ eday_delta`. The critique's code subtracted `eday_delta`; since `eday_delta` is negative, that sign was backwards.
5. **Turnout factor by county type** comes from that type's fully counted counties, falling back to the statewide factor.
6. **The 90% range** combines county-level noise (0.08 log-odds), uncertainty in the statewide shift, and a county-type term that grows when a type has little counted vote. That last term is what keeps the range honest when, say, only small counties have reported.

**Simulated checks:**

| Scenario | True result | v1 | v2 (90% range) |
|---|---|---|---|
| Even −0.05 shift, ⅔ counted (TX) | 48.9% | 49.1% | 48.8% (46.7–50.9) |
| GA early-vote dump exactly at early-vote win pace | about 50% | 52.2% (fooled by early votes) | 48.7% |
| Uneven win (big counties +0.25, small −0.10), only small counties counted (TX) | 52.0% | 48.3% | 47.6% (42.6–52.5) |

In the uneven case, **neither model can see a lopsided path before the big counties report.** v2's range is wide enough to admit it; v1's "too close" outlook says nothing. The shift-by-type panel is the tool for reading that situation.

### 9.5 County-swing spread (calibration for later)
How far counties' 2020→2024 presidential swings scattered around their state's swing, in log-odds, by size quintile from smallest to largest:

| State | Spread by size quintile |
|---|---|
| GA | 0.115, 0.094, 0.085, 0.063, 0.071 |
| NC | 0.094, 0.070, 0.057, 0.057, 0.042 |
| TX | 0.132, 0.100, 0.079, 0.094, 0.093 |
| IA | 0.047, 0.050, 0.046, 0.035, 0.035 |
| OH | 0.047, 0.031, 0.038, 0.043, 0.035 |
| MI | 0.042, 0.046, 0.050, 0.042, 0.065 |

v2 uses a single 0.08. These figures are the starting point for fitting the band and the simulation after tonight.

### 9.6 Operations
- **Raw archive.** Every civicAPI response the AI job pulls (every race, every county) is saved each cycle as one gzipped file on the repo's `archive` branch. That branch is kept off the site build. Tonight's counting order is the dataset a real backtest needs.
- **AI notes.** Each note now carries the time of the data it explains. Claude is told which counties are likely early votes only, along with the v2 projection and the shift panel. It may add a caveat to a verdict but never override it.
- **Not adopted: running the AI job on a laptop.** The GitHub job is one long loop, not a 5-minute cron, so GitHub's scheduler only affects its 6:40 pm start. A sleeping laptop is the bigger risk. Instead, the start is checked at 6:42 pm and kicked off by hand if needed.

### 9.7 Reading rules for tonight
1. **Read fully counted counties by type first,** against the needed shift, not against zero.
2. **Discount "ahead" in any metro county under about 50% counted** until its first Election Day batch lands. In Michigan the risk can run the other way: late Detroit absentee votes lean Democratic.
3. **In IA, OH and TX, a rural county behind pace is expected on a winning path.** Watch whether the metros beat pace by enough.
4. **Trust the outlook less when the remaining vote sits in one or two metros.**
5. **In TX-15, TX-23 and OH-7, trust district totals over the split-county parts.**
6. **100% reporting isn't final.** Provisional ballots, cured ballots and late mail (OH and TX accept some mail after Election Day) still come in.

### 9.8 Left for after the election
- a demographic swing model (ACS data);
- a simulation-based outlook;
- fitting the baseline weights against holdout elections;
- a full vote-type model using 2020 data;
- a replay backtest on tonight's archive;
- precinct-level 2026 district lines;
- three-way race support;
- relabeling verdicts as "vs. even path."

## 10. Race calls: major decision desks, sourced

civicAPI's race calls are not used. A race shows as called when one of these decision desks has called it:
- The Associated Press
- NBC News
- CNN
- ABC News
- CBS News
- Fox News
- Decision Desk HQ

Outlets that publish AP's call, such as newspapers, local TV, NYT and the Washington Post, count as AP.

**How calls are found.** `scripts/ap_calls.mjs` has Claude Code search the web for reports of each desk's call. A call counts only if a source explicitly attributes it to that desk. Candidate claims, concessions and leads don't count. A call is dropped if:
- the named winner isn't on the ballot;
- the caller isn't one of the desks above;
- there's no source link.

**How calls are shown.** Each race's card lists every desk that has called it, with the call time when the source gives one, and each desk's name links to the page that reported its call. If desks name different winners, the card flags it ("⚠ Calls disagree").

**When a race gets checked.** A race is checked only after its final poll close, since no desk calls earlier. The final closes are:
- GA: 7:00 pm ET
- NC and OH: 7:30 pm
- MI, IA and statewide TX: 9:00 pm
- Texas House and legislative races in Central time: 8:00 pm

After that, a race is checked when any of these happens:
1. **Poll close itself.** Its first check comes right after poll close, because clear races are called at poll close.
2. **A big vote drop.** At least 10 more points reporting, or at least 15,000 more votes (or 15% more than at the last check).
3. **A clear margin.** A margin of 10 or more points with at least 20% reporting, rechecked every 15 minutes.
4. **Nearly done.** At least 95% reporting, rechecked every 15 minutes.
5. **Periodic.** A recheck every 40 minutes otherwise.

**After the first call**, the race is rechecked every 20 minutes to pick up other desks' calls. That stops once AP and at least two other desks have called it, or two hours after the first call.

**Limits.** A race is never checked more than once every 8 minutes. Each cycle checks at most 8 races in one Claude call, in priority order: Senate and governor first, then SAM targets, then other House races, then everything else. The checker runs in the background of the AI job. Calls, check history and a log are in `data/model/ap_calls.json`.
