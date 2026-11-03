# County Targets

`county/index.html` is a county-by-county win-number map for SAM's geographies: statewide in GA, IA, MI, NC, OH and TX, plus IA-1, IA-2, MI-4, MI-10, NC-5, NC-11, OH-7, TX-15 and TX-23.

- **Win pace.** Each county's lean comes from a log-odds blend: 60% 2024 presidential and 40% the 2022 statewide race(s). Every county is then shifted by the same amount until the geography lands at the win target (50% two-party by default; a slider changes it). The shifted share is the county's win pace. Expected 2026 vote is 2022 turnout, re-estimated live from civicAPI's percent reporting.
- **Live results.** The page pulls county results straight from civicAPI in the browser every 90 seconds, using the race IDs in `/races.json`.
- **Verdicts.** `county/engine.js` rates each county as ahead of, on, or behind win pace. The band widens when little of the vote is counted.
- **AI notes.** `.github/workflows/county-blurbs.yml` runs Claude Code on the Max-plan token (secret `CLAUDE_CODE_OAUTH_TOKEN`) about every 8 minutes. It writes the notes to `data/model/blurbs.json`. Claude explains each verdict; it never sets one. If the job is down, the page falls back to template sentences.
- **History.** Data comes from MIT Election Data + Science Lab (2018, 2022 and 2024 precinct files), OpenElections (2006–2020 Senate and governor races), and county presidential returns from 2008–2024. To rebuild `data/model/model.json`, use `tools/county-model/`.
- **Testing.** Add `?demo=1` to the URL for simulated returns.
