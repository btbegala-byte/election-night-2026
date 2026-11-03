# Model v2.0: how the alt projection works

v2 is the second projection on the dashboard, labeled **"Alt model (v2, testing)."** It runs in **shadow mode**: the headline projection and the outlook chip still come from the original engine (v1). v2 sits next to it with a 90% range, so the two can be compared all night.

All of the code is in `county/engine.js`, in `compute()`, inside the block marked `v2 projection (shadow)`. The page, the AI notes, the race snapshots and the chat all call the same function, so they always see the same v2 number.

This document covers v2 step by step: inputs, every formula, every constant, a worked example with real numbers, what it gets right and wrong in simulation, and how to change it. For how the baseline itself was built, see `METHODOLOGY.md` sections 1–3.

---

## 1. What v2 is for

v1 makes two mistakes that v2 fixes:

1. **v1 pulls the uncounted vote toward win pace.** Win pace is the scenario where the Democrat lands at exactly 50%, so v1's projection is anchored to a tie and sits at "too close to call" longer than the data justifies.
2. **v1 applies one statewide average to every unreported county.** Whichever counties report first, usually small rural ones or big-county early votes, set the projection for counties that look nothing like them.

v2 instead:

- **Anchors to the baseline, not to a tie.** The prior is "the county votes like its blended 2024/2022 baseline," with no shift.
- **Estimates the swing separately for each type of county,** and projects each unreported county from its own type.
- **Works in log-odds throughout,** the same scale the baseline was built on.
- **Corrects for early votes** where we have the data.
- **Reports a range,** and the range widens when a whole type of county hasn't reported yet.

---

## 2. Notation

| Symbol | Meaning |
|---|---|
| `σ(x)` | `1 / (1 + e^(−x))`, which turns log-odds into a share |
| `logit(p)` | `ln(p / (1 − p))`. In v2, `p` is clamped to 0.5%–99.5% first |
| `b` | County's baseline lean in log-odds: `0.6·logit(2024 pres D share) + 0.4·logit(2022 midterm D share)`, from `model.json` |
| `w` | County's expected two-party vote: its 2022 two-party vote |
| `s` | The win-pace shift: the single number that puts the state at 50% when added to every county's `b` |
| `t` | Win pace: `σ(b + s)` |
| `V` | Two-party votes counted (Dem + GOP) |
| `A` | Live Dem two-party share: `D / V` |
| `p` | civicAPI's percent reporting for the county, as a fraction |
| `f` | Share of the county's vote counted (section 3.2) |
| `E` | Expected final two-party vote for the county (sections 3.3 and 5.1) |

All shares are **two-party** (Dem ÷ (Dem + GOP)). Third parties are ignored in the math.

---

## 3. Per-county preparation (shared with v1)

These steps run for every county before either projection. v2 reads their outputs.

### 3.1 Raw inputs from civicAPI

For each county in the race's `region_results`:
- Dem votes `D`, GOP votes `R`, other votes.
- `percent_reporting`, normalized to 0–100. If every county's value is at or below 1, they're treated as fractions and multiplied by 100.

`V = D + R`. A county is **complete** when percent reporting is 100.

### 3.2 Share counted, `f`

```
f0 = min(0.99, V / E)                        E = w × statewide turnout factor (3.4)
if percent reporting p is available and the county isn't complete:
    f = min(0.99, 0.75·p + 0.25·f0)
if complete:  f = 1
```

### 3.3 Expected final vote (with the guard added on Election Day)

```
if p > 0.05:
    E_implied = V / p, held within [0.6·E, 1.8·E]
    k = min(1, 1.5·p)
    E_eff = k·E_implied + (1 − k)·E
if complete:  E_eff = V
E_county = max(E_eff, V)
```

At 10% reporting, the county's own count gets 15% of the weight. At two-thirds reporting and above, it gets all of it. The 0.6–1.8× cap stops a tiny `p` from implying an absurd total.

### 3.4 Statewide turnout factor (v1's)

The factor starts at 1.0, meaning 2026 turnout matches 2022. Once at least 3 counties are complete, and those counties held at least 8% of the expected vote:

```
turnout factor = Σ V (complete counties) / Σ w (complete counties), held within [0.55, 1.7]
```

### 3.5 The "likely early vote only" flag

A county is flagged when it isn't complete **and** any of these is true:

1. **No precincts reporting:** `p < 0.01` with votes posted. That pattern means an early or mail dump.
2. **Just after poll close:** it's within 45 minutes after poll close in a state that counts early and mail first:
   - GA from 7:00 pm ET
   - NC and OH from 7:30 pm
   - TX from 8:00 pm
3. **Vote-type data says so.** civicAPI doesn't provide vote type today, so this rule is inactive.

The flag affects the verdict (section 3.6) and how v2 treats the county (sections 5.2 and 5.5).

### 3.6 The verdict (shared, for reference)

```
pace to compare against:
    t_E = σ(b + s + early_delta)   if flagged and the county's 2022 early skew is known
    t_E = t                        otherwise
gap = A − t_E
band = 0.012 + 0.07·(1 − f) + 0.03·[flagged] + 0.01·[split county]
verdict:
    too early   if f < 0.03
    ahead       if gap > band
    behind      if gap < −band
    on pace     otherwise
```

An "ahead" verdict on a flagged county is shown as "Ahead (early votes only)" and left out of the headline count.

---

## 4. The two inputs v2 adds

### 4.1 County type (`stratum`)

Built by `tools/county-model/add_strata.py` from the model itself, separately for each state:

- **Size:** sort counties by `w` from largest down. Counties are "big" until the running total reaches half the state's expected vote; the rest are "small."
- **Lean:** a county is "Dem-leaning" if its `b` is above the state's vote-weighted median `b`, otherwise "GOP-leaning."
- **Texas only:** among the non-big counties, the third with the largest 2020→2024 presidential shift toward the GOP (in log-odds) become **"realigning."** This stands in for heavily Latino counties without needing Census data. It's imperfect: Lubbock and Brazos land in it too.
- **House-district parts** inherit their whole county's type.

Count of counties per type:

| State | Big, Dem | Big, GOP | Small, Dem | Small, GOP | Realigning |
|---|---|---|---|---|---|
| GA | 6 | 5 | 14 | 134 | — |
| NC | 8 | 5 | 15 | 72 | — |
| OH | 7 | 3 | 5 | 73 | — |
| MI | 5 | 1 | 4 | 73 | — |
| IA | 8 | 2 | 2 | 87 | — |
| TX | 5 | 3 | 3 | 161 | 82 |

The big Texas counties are Harris, Dallas, Bexar, Travis and Fort Bend (Dem-leaning), plus Tarrant, Collin and Denton (GOP-leaning).

### 4.2 Early-vote skew (`early_delta`, `eday_delta`)

Built by `tools/county-model/mode_skew.py` from MIT's 2022 Senate precinct rows that carry vote type:

```
early_delta = logit(D share of early + mail votes)  − logit(D share of all votes)
eday_delta  = logit(D share of Election Day votes)  − logit(D share of all votes)
```

| State | Which vote types count as early | Statewide early_delta | Statewide eday_delta | Early share of 2022 vote |
|---|---|---|---|---|
| GA | advance in-person + absentee | +0.187 | −0.341 | 64% |
| NC | one-stop + absentee by mail | +0.246 | −0.353 | 58% |
| IA | absentee | +0.644 | −0.285 | 30% |

- **Small counties:** a county with fewer than 300 early or Election Day votes uses the statewide figures.
- **TX and OH:** their files report totals only, so they have no skew table.
- **MI:** its 2022 vote-type data is partial, so it also has none.

In those three states, flagged counties still get the wider band and the lower weight in v2, but no direction correction.

---

## 5. The v2 projection, step by step

### Constants

| Name | Value | Meaning |
|---|---|---|
| `PRIOR_WEIGHT` | 0.05 | The baseline prior counts as if 5% of the expected vote were already in |
| `STRATUM_POOL` | 0.05 | Each county type is pulled toward the statewide shift as if it had 5% of the vote at that shift |
| `EARLY_RELIAB` | 0.35 | A flagged county's votes count at 35% weight |
| `COUNTY_SD` | 0.08 | Typical county-level scatter around its type's shift, in log-odds |
| `STRATUM_SD` | 0.30 | How far a whole county type could be from the rest when it has no counted vote, in log-odds |

They're defined in one line near the top of `engine.js` (`const V2 = {...}`). None are fitted yet; see section 8.

Let `E_tot` = the sum over all counties of `max(E_county, V)`.

### 5.1 Expected vote, v2 version (`E2`)

v2 uses a turnout factor **for each county type** instead of one statewide factor:

```
turnout factor for type k:
    = Σ V / Σ w over complete counties of type k     if type k has ≥ 2 complete counties (held within 0.55–1.7)
    = the statewide factor (3.4)                     otherwise

E2 = V                                   if complete
E2 = E_county                            if reporting with p > 0.05 (the guarded figure from 3.3)
E2 = max(V, w × type k's turnout factor) otherwise
```

### 5.2 Each reporting county's observed shift

A county counts as reporting here if `V > 0` and `f ≥ 0.03`. For each one:

```
obs   = logit(A) − b − (flagged ? early_delta : 0)
omega = V × (flagged ? 0.35 : 1)
```

- **`obs`** is how far the county is running from its own baseline, in log-odds. For a flagged county, the early-vote skew comes out first, so `obs` estimates the full-count shift rather than the early-vote shift.
- **`omega`** is how much the county is trusted. It's measured in votes, discounted for flagged counties.

Counties not reporting get `omega = 0`.

### 5.3 Statewide shift `ŝ`

```
λ = PRIOR_WEIGHT × E_tot
ŝ = (λ × 0 + Σ omega·obs) / (λ + Σ omega)
```

`ŝ` is the vote-weighted average observed shift, pulled toward 0 by a prior worth 5% of the expected vote. A shift of 0 means "every county votes its baseline."

How much the prior still matters at a given share counted:
- 10% counted (all trusted votes): about 33% of the weight.
- 25%: about 17%.
- 50%: about 9%.

### 5.4 Shift for each county type, `s_k`

```
μ = STRATUM_POOL × E_tot
s_k = (μ × ŝ + Σ_{counties in k} omega·obs) / (μ + Σ_{counties in k} omega)
```

- **A type with no counted vote** gets exactly `ŝ`.
- **A type with plenty of counted vote** gets close to its own average.

Picture Texas when only small rural counties have reported. Their shift sets `ŝ`, and the unreported big metros inherit `ŝ`. That's the limitation discussed in section 7, and it's why section 5.6 widens the range for unobserved types.

### 5.5 Projecting each county's remaining vote

```
remaining = max(0, E2 − V)
base      = b + s_k
if the county isn't reporting (omega = 0):
    x = base
else:
    resid = obs − s_k
    ρ     = flagged ? 0.3 : 0.4 + 0.5·f
    x     = base + ρ·resid + (flagged ? eday_delta : 0)
share of remaining vote = σ(x), held within [3%, 97%]
```

- **`ρ`** is how much of a county's own gap from its type is expected to persist in the rest of its count. It ranges from 40% when barely counted to 90% when nearly done. It's 30% for flagged counties.
- **Flagged counties:** their remaining vote is assumed to be Election Day votes, so the Election Day skew is **added**. Since `eday_delta` is negative, that makes the remaining vote less Democratic. (The outside critique's code subtracted it, which pushes the remaining vote the wrong way. That's fixed here.)

### 5.6 Projected final share and 90% range

```
projected D  = Σ (D counted + remaining × σ(x))
projected total = Σ (V + remaining)
v2 share  = projected D / projected total
v2 margin = 2 × v2 share − 1
```

The range combines three sources of uncertainty. In each, `σ(x)(1 − σ(x))` converts log-odds noise into votes:

```
county noise:        Σ_i ( remaining_i × σ(x_i)(1 − σ(x_i)) × 0.08 )²
county-type noise:   Σ_k ( R_k × 0.30 × μ / (μ + Σ omega in k) )²
                     where R_k = Σ remaining·σ(x)(1 − σ(x)) over counties of type k
statewide noise:     ( R_all × sd_state )²
                     where sd_state = 0.02 + 0.12 × (1 − min(1, Σ omega / E_tot))

sd = √(sum of the three) / projected total
90% range = v2 share ± 1.645 × sd
```

What each term does:
- **County-type term:** big for a type with no counted vote and near zero once a type is well counted. This keeps the range honest when, say, only small counties have reported.
- **Statewide term:** shrinks as more trusted vote comes in.
- **County term:** small, and treated as independent across counties.

---

## 6. Worked example (Georgia Senate, simulated mid-count)

**The setup.** It's 9:30 pm ET, so Georgia's early-vote window has ended.
- Every small, GOP-leaning county is complete, running 0.04 log-odds below win pace.
- Fulton is 60% reported, running 0.06 above pace.
- Cobb has posted only an early/mail dump, at 0% reporting.
- Everything else is unreported.

The fixed inputs: `s = 0.0472` and `E_tot = 3,960,271`.

| County | Type | b | V | A | p | Flagged | Win pace t | obs | omega | E2 |
|---|---|---|---|---|---|---|---|---|---|---|
| Fulton | Big, Dem | 0.969 | 248,271 | 74.58% | 0.60 | no | 73.42% | +0.107 | 248,271 | 414,613 |
| Cobb | Big, GOP-leaning | 0.268 | 168,231 | 61.93% | 0.00 | yes | 57.81% (early-vote pace 61.22%) | +0.077 (after removing its +0.142 early skew) | 58,881 | 311,994 |
| Appling | Small, GOP | −1.487 | 6,777 | 18.55% | complete | no | 19.16% | +0.007 | 6,777 | 6,777 |
| DeKalb | Big, Dem | 1.595 | 0 | — | — | — | 83.78% | — | 0 | 300,460 |

**Step 5.3, the statewide shift:** `ŝ = 0.020`. The small rural counties are close to their baseline, Fulton is a little above, and Cobb's early-only signal is discounted to 35%.

**Step 5.4, the shift for each type:**

| Type | s_k | Driven by |
|---|---|---|
| Small, GOP | 0.009 | Its own fully counted counties |
| Big, Dem | 0.069 | Fulton |
| Big, GOP-leaning | 0.033 | Cobb, discounted |
| Small, Dem | 0.020 | No votes, so it gets `ŝ` |

**Step 5.5, the projections:**

| County | Projected final share | Why |
|---|---|---|
| DeKalb | 84.07% | Nothing counted; projected at `b + s_k(Big, Dem)`, slightly above its 83.78% pace because Fulton is running ahead |
| Cobb | 56.87% | Its remaining vote is projected as Election Day votes (−0.276 skew), so its final share lands well below the 61.93% now showing |
| Fulton | 74.49% | Keeps most of its lead over its type |

**Result:**

| | Projection |
|---|---|
| v1 | 49.83% Dem two-party |
| v2 | 49.68% Dem two-party, 90% range 47.27%–52.09% |

About half the expected vote is counted.

The two models agree here because the scenario has no lopsided-path problem. Where they part ways is in the early-vote and lopsided cases in section 7.

---

## 7. Simulated checks

Each scenario sets a true result, feeds the engine counted counties built from it, and compares the projections with the truth.

| Scenario | True result | v1 | v2 (90% range) | Read |
|---|---|---|---|---|
| TX: every county 0.05 below pace, ⅔ counted | 48.9% | 49.1% | 48.8% (46.7–50.9) | v2 closer; v1 pulled toward 50% |
| GA: early-vote dump exactly at early-vote win pace | about 50% | 52.2% | 48.7% | v1 fooled by early votes; v2 corrects for them |
| GA: every county 0.04 above pace, 25% counted | 50.8% | 50.6% | 50.7% (47.0–54.4) | Both fine |
| TX: lopsided Dem win (big +0.25, small −0.10), only small counties counted | 52.0% | 48.3% | 47.6% (42.6–52.5) | **Both miss.** v2's range barely includes the truth |
| IA: same lopsided case | 51.9% | 48.2% | 47.4% (41.5–53.3) | Same |

**The lopsided case is the important limit.** Before any big county reports, no model can know the big counties are swinging differently, because the only data comes from small counties. v2 doesn't fix that. It widens the range instead of claiming false confidence. The tool for reading that moment is the **observed-vs-needed shift table**: if small counties come in at −0.10 against a needed +0.28, the question is whether the first big-county numbers run far enough above +0.28 to make up for it.

---

## 8. Known limitations and what's not fitted

- **None of the five constants are fitted.** They're informed guesses checked against the simulations above:
  - `PRIOR_WEIGHT` was lowered from the critique's 0.15. At 0.15 the prior still held about 18% of the weight with two-thirds of the vote counted.
  - `COUNTY_SD` = 0.08 sits in the middle of the measured 2020→2024 county-swing spread: 0.03–0.13 depending on state and county size, per `METHODOLOGY.md` 9.5.
- **County types are crude.** Two size bins, two lean bins, plus Texas's realigning proxy. A demographic regression would do better (Tier 3 in the critique).
- **Early-vote correction exists only for GA, NC and IA,** and it uses 2022 patterns. If Republicans voted early in larger numbers in 2026 than in 2022, the correction overstates the early-vote Democratic lean. In TX, OH and MI, flagged counties are only down-weighted, not corrected.
- **The 45-minute window is a blunt rule.** It flags every county in the state, including ones that post Election Day precincts quickly.
- **The meaning of civicAPI's percent reporting is unconfirmed.** If it counts precincts rather than votes, `f` and `E_eff` run ahead of the real count in counties where big precincts report late.
- **The range is approximate.** It treats the three error sources as independent and normal. It's a sanity band, not a calibrated probability.
- **Late ballots aren't modeled.** 100% reporting is treated as final, but provisional, cured and late-arriving mail ballots still change totals.
- **Two-party only.**

---

## 9. Where v2 shows up

| Place | What's shown |
|---|---|
| Dashboard map panel (each state) | "Alt model (v2, testing): D+x · 90% range …" under the headline numbers |
| Full County Targets page | Same line, under the counties gaining and losing the most against win pace |
| AI notes and race snapshots | The v2 margin and range are in the prompt. Claude may add a caveat when v1 and v2 disagree by more than 1 point, but can't override the v1 verdict |
| Chat | The v2 margin, range and observed-vs-needed table are in the snapshot Claude reads |

v2 also returns `ŝ` (`v2.sHat`), the shift for each county type (`v2.sK`), and the turnout factor for each type (`v2.tfK`). They're available in the browser console as `CTEngine.compute(...)` output, but not displayed.

---

## 10. Changing or promoting v2

- **Tuning:** edit the `V2` constants in `county/engine.js`, bump the `?v=` numbers on the script tags in `index.html` and `county/index.html`, and push. Every page and the AI job pick up the change on the next refresh.
- **Making v2 the headline:** in the dashboard and full page, swap which projection drives the big number and the outlook chip. Use `res.v2.margin`, and judge "on path / off pace / too close" by whether the 90% range sits entirely above 50%, entirely below 50%, or straddles it. Don't do this tonight without watching both models track for a while.
- **Testing:** the simulations above come from a short Node script that builds fake county results from the model, runs `compute()` and compares the result with the known truth. The scenarios are reproducible by setting each county's live share to `σ(b + s + offset)`, with the offset chosen per county type.
- **After the election:** replay tonight's archived civicAPI responses (the `archive` branch, one gzipped file per 5-minute cycle) through v1 and v2, score both, and fit the constants (`METHODOLOGY.md` 9.8).
