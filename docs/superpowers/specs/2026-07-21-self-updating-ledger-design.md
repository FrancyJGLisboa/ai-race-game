# Self-updating AI-race signal ledger — design

Date: 2026-07-21
Status: approved (Francy, in-session)

## Goal

Keep the existing China×US open-model-race ledger (index.html) alive without
manual news-hunting. A daily keyless job harvests headlines per open signal and
surfaces them as evidence on the page. Francy remains the sole referee: the
machine proposes evidence, never resolutions.

## Decisions (locked)

- Topic unchanged: AI race, Portuguese UI, single-file page.
- Autonomy: propose-only. The harvester NEVER writes `resolved`.
- Hosting: public GitHub repo + GitHub Pages; daily GitHub Action commits
  `signals.json` only when evidence changed.
- No LLM, no API keys: Google News RSS via Python stdlib. Every evidence URL
  is provably from a feed fetched that run.

## Components

1. **signals.json** — per signal, two new fields:
   - `queries`: 2–4 search strings for Google News RSS.
   - `evidence`: list of `{date, title, url}` (ISO date), deduped by URL,
     capped at 10 newest per signal.
   `resolved` stays the official gavel, edited by Francy on GitHub.

2. **scripts/harvest.py** — stdlib only (urllib, xml.etree, json).
   For each signal with `resolved == null`: fetch RSS per query, keep items
   ≤7 days old, dedupe against existing evidence, merge, write back only if
   changed (byte-identical otherwise). Exit code signals changed/unchanged.

3. **.github/workflows/harvest.yml** — cron daily; run script; commit+push
   only if `signals.json` differs.

4. **index.html** — render `evidence` as dated links under each pending
   signal; `NOVIDADE` badge when newest evidence postdates the last journal
   snapshot. Nothing else changes; `#v3` share links keep parsing.

## Checks (loss function)

```yaml
checks:
  - check: "No-op harvest run leaves signals.json byte-identical (no noise commits)"
    false_pass: "Commit something trivial daily so the repo looks alive"
    mitigation: "Unit test asserts byte-identical output on a run with no fresh items; workflow commits only on diff"
  - check: "Every evidence URL is a subset of URLs present in RSS fetched that run"
    false_pass: "Hardcode plausible-looking links"
    mitigation: "Deterministic stdlib code, no LLM; unit test feeds fixture RSS and asserts output URLs ⊆ fixture URLs"
  - check: "Pre-revamp #v3 share hash still parses against the new catalog"
    false_pass: "Render evidence but silently drop old shared scenarios"
    mitigation: "Node test runs the extracted hash-parse logic on a frozen pre-revamp hash"
  - check: "Harvester never writes the resolved field"
    false_pass: "Auto-resolving inflates apparent usefulness while corrupting the Brier scoreboard"
    mitigation: "Unit test runs harvest over a catalog with resolved values set and asserts they are unchanged"
holdout: "Weekly, Francy eyeballs one random signal's evidence for relevance (junk-headline rate). Manual, never automated, never fed back into query tuning."
```

## Skipped (add only if holdout junk-rate annoys)

LLM judgment of direction, auto-authored new signals, evidence ranking.
