# Self-Updating AI-Race Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily keyless GitHub Action harvests Google News RSS evidence per open signal into `signals.json`; the page renders it; Francy stays the sole referee.

**Architecture:** Pure-function harvester (stdlib Python) merges fresh RSS items into per-signal `evidence` lists; a cron workflow commits only on change; `index.html` renders evidence links plus a NOVIDADE badge. `resolved` is never machine-written.

**Tech Stack:** Python 3 stdlib (urllib, xml.etree, json), pytest (dev-only via `uv run --with pytest`), GitHub Actions, GitHub Pages, vanilla JS.

## Global Constraints

- Python stdlib only in `scripts/harvest.py` — no pip installs in CI.
- Harvester never writes `resolved` (spec check C4).
- No file write when nothing changed — byte-identical no-op (spec check C1).
- Evidence URLs must originate from fetched RSS or pre-existing evidence (spec check C2).
- Signal ids are frozen: `weights,qwen,ban,labs,waico,ipo,saturation` (spec check C3 — old `#v3` share links key on ids).
- Evidence: max 10 per signal, max age 7 days at harvest time, ISO dates.
- Immutability: harvest merge returns new dicts, never mutates input catalog.

---

### Task 1: Harvester with tests

**Files:**
- Create: `scripts/harvest.py`
- Test: `tests/test_harvest.py`

**Interfaces:**
- Produces: `parse_items(xml_bytes) -> list[dict]` (each: date, title, url, _dt); `harvest(catalog, fetched_items_by_signal, now) -> (new_catalog, changed)`; `main()` reads/writes `signals.json` relative to repo root, exits 0 always, prints `changed` or `unchanged`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_harvest.py
import copy
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import harvest

NOW = datetime(2026, 7, 21, 12, 0, tzinfo=timezone.utc)

FIXTURE_RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel>
<item><title>Moonshot publica pesos do K3</title>
  <link>https://example.com/k3-weights</link>
  <pubDate>Mon, 20 Jul 2026 08:00:00 GMT</pubDate></item>
<item><title>Old news</title>
  <link>https://example.com/old</link>
  <pubDate>Mon, 01 Jun 2026 08:00:00 GMT</pubDate></item>
</channel></rss>"""

def catalog():
    return {
        "version": 1, "updated": "2026-07-20",
        "signals": [
            {"id": "weights", "title": "t", "L": {}, "resolved": None,
             "queries": ["Kimi K3 weights"], "evidence": []},
            {"id": "ipo", "title": "t2", "L": {}, "resolved": "yes",
             "queries": ["Moonshot IPO"], "evidence": []},
        ],
    }

def test_c2_output_urls_subset_of_feed():
    items = harvest.parse_items(FIXTURE_RSS)
    feed_urls = {i["url"] for i in items}
    out, changed = harvest.harvest(catalog(), {"weights": items}, NOW)
    ev_urls = {e["url"] for s in out["signals"] for e in s.get("evidence", [])}
    assert changed and ev_urls and ev_urls <= feed_urls

def test_fresh_window_and_cap():
    items = harvest.parse_items(FIXTURE_RSS)
    out, _ = harvest.harvest(catalog(), {"weights": items}, NOW)
    ev = next(s for s in out["signals"] if s["id"] == "weights")["evidence"]
    assert [e["url"] for e in ev] == ["https://example.com/k3-weights"]  # old item dropped
    assert ev[0]["date"] == "2026-07-20"
    assert "_dt" not in ev[0]

def test_c1_noop_is_unchanged():
    cat = catalog()
    items = harvest.parse_items(FIXTURE_RSS)
    once, _ = harvest.harvest(cat, {"weights": items}, NOW)
    twice, changed = harvest.harvest(once, {"weights": items}, NOW)  # same items again
    assert not changed and twice == once

def test_c4_resolved_untouched_and_skipped():
    cat = catalog()
    items = harvest.parse_items(FIXTURE_RSS)
    out, _ = harvest.harvest(cat, {"weights": items, "ipo": items}, NOW)
    ipo = next(s for s in out["signals"] if s["id"] == "ipo")
    assert ipo["resolved"] == "yes" and ipo["evidence"] == []  # resolved signal never harvested
    assert all(s.get("resolved") == c.get("resolved")
               for s, c in zip(out["signals"], catalog()["signals"]))

def test_input_not_mutated():
    cat = catalog()
    snapshot = copy.deepcopy(cat)
    harvest.harvest(cat, {"weights": harvest.parse_items(FIXTURE_RSS)}, NOW)
    assert cat == snapshot

def test_c1_file_not_rewritten_when_unchanged(tmp_path):
    p = tmp_path / "signals.json"
    p.write_text(json.dumps(catalog(), ensure_ascii=False, indent=2) + "\n")
    before = p.read_bytes()
    harvest.write_if_changed(p, catalog(), changed=False, today="2026-07-21")
    assert p.read_bytes() == before

def test_c3_signal_ids_frozen():
    real = json.loads((Path(__file__).resolve().parents[1] / "signals.json").read_text())
    assert [s["id"] for s in real["signals"]] == \
        ["weights", "qwen", "ban", "labs", "waico", "ipo", "saturation"]
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `uv run --with pytest pytest tests/ -q`
Expected: FAIL / collection error — `ModuleNotFoundError: No module named 'harvest'`

- [ ] **Step 3: Implement `scripts/harvest.py`**

```python
#!/usr/bin/env python3
"""Harvest Google News RSS evidence for open signals. Stdlib only.

Proposes evidence; NEVER writes `resolved` — Francy is the referee.
"""
import json
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

FEED = "https://news.google.com/rss/search?q={q}&hl=pt-BR&gl=BR&ceid=BR:pt-419"
MAX_EVIDENCE = 10
MAX_AGE_DAYS = 7
ROOT = Path(__file__).resolve().parents[1]


def fetch_feed(query):
    url = FEED.format(q=urllib.parse.quote(query))
    req = urllib.request.Request(url, headers={"User-Agent": "ai-race-ledger/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def parse_items(xml_bytes):
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        pub = it.findtext("pubDate") or ""
        try:
            dt = parsedate_to_datetime(pub)
        except (TypeError, ValueError):
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if title and link.startswith("http"):
            items.append({"date": dt.date().isoformat(), "title": title,
                          "url": link, "_dt": dt})
    return items


def harvest(catalog, fetched_items_by_signal, now):
    """Merge fresh items into per-signal evidence. Pure: returns (new_catalog, changed)."""
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    changed = False
    new_signals = []
    for s in catalog["signals"]:
        s = dict(s)
        if s.get("resolved") is None and s["id"] in fetched_items_by_signal:
            existing = list(s.get("evidence") or [])
            seen = {e["url"] for e in existing}
            fresh = []
            for it in fetched_items_by_signal[s["id"]]:
                if it["_dt"] >= cutoff and it["url"] not in seen:
                    seen.add(it["url"])
                    fresh.append({"date": it["date"], "title": it["title"],
                                  "url": it["url"]})
            if fresh:
                s["evidence"] = sorted(existing + fresh,
                                       key=lambda e: e["date"],
                                       reverse=True)[:MAX_EVIDENCE]
                changed = True
        new_signals.append(s)
    return {**catalog, "signals": new_signals}, changed


def write_if_changed(path, catalog, changed, today):
    if not changed:
        return False
    out = {**catalog, "updated": today}
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    return True


def main():
    path = ROOT / "signals.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    fetched = {}
    for s in catalog["signals"]:
        if s.get("resolved") is not None:
            continue
        items = []
        for q in s.get("queries", []):
            try:
                items.extend(parse_items(fetch_feed(q)))
            except OSError as e:  # network failure on one query must not kill the run
                print(f"warn: {s['id']} query {q!r}: {e}", file=sys.stderr)
        if items:
            fetched[s["id"]] = items
    merged, changed = harvest(catalog, fetched, now)
    wrote = write_if_changed(path, merged, changed, now.date().isoformat())
    print("changed" if wrote else "unchanged")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests** — `uv run --with pytest pytest tests/ -q`. Expected: `test_c3_signal_ids_frozen` may still FAIL (queries/evidence not yet in real signals.json is fine — it only checks ids, so expected: all PASS).

- [ ] **Step 5: Commit** — `git add scripts tests && git commit -m "feat: keyless RSS evidence harvester (checks C1,C2,C4 enforced by tests)"`

---

### Task 2: signals.json gains queries + evidence

**Files:**
- Modify: `signals.json`

**Interfaces:**
- Produces: every signal has `queries` (list of 2–3 strings) and `evidence: []`. Consumed by `harvest.main()` and `index.html` loadCatalog.

- [ ] **Step 1: Add fields.** Per signal, add `"queries"` and `"evidence": []` after `"resolved"`. Queries (mix pt/en, Google News search strings):
  - weights: `["Kimi K3 open weights", "Moonshot AI pesos abertos", "Kimi K3 release"]`
  - qwen: `["Qwen 3.8 benchmark", "Alibaba Qwen 3.8"]`
  - ban: `["US ban Chinese AI models", "banimento modelos IA chineses"]`
  - labs: `["Chinese AI lab open source model", "China open weights flagship"]`
  - waico: `["WAICO artificial intelligence", "WAICO adoption countries"]`
  - ipo: `["Moonshot AI IPO", "Moonshot IPO valuation"]`
  - saturation: `["Moonshot GPU shortage", "China AI inference capacity"]`
  Also extend `_como_editar` with one sentence: evidence é preenchida pelo robô diário; nunca edite resolved via robô — resolved continua manual.
- [ ] **Step 2: Validate** — `python3 -c "import json;json.load(open('signals.json'))"` then `uv run --with pytest pytest tests/ -q` (all pass, incl. C3 ids-frozen).
- [ ] **Step 3: Commit** — `git add signals.json && git commit -m "feat: per-signal news queries and evidence slots"`

---

### Task 3: Daily GitHub Action

**Files:**
- Create: `.github/workflows/harvest.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: harvest
on:
  schedule:
    - cron: "17 9 * * *"   # daily 09:17 UTC
  workflow_dispatch:
permissions:
  contents: write
jobs:
  harvest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: python3 scripts/harvest.py
      - name: Commit only if evidence changed   # C1: no noise commits
        run: |
          if ! git diff --quiet signals.json; then
            git config user.name "harvest-bot"
            git config user.email "actions@users.noreply.github.com"
            git add signals.json
            git commit -m "chore: harvest evidence $(date -u +%F)"
            git push
          else
            echo "no new evidence"
          fi
```

- [ ] **Step 2: Commit** — `git add .github && git commit -m "ci: daily evidence harvest workflow"`

---

### Task 4: Page renders evidence + NOVIDADE badge

**Files:**
- Modify: `index.html` (CSS block ~line 140; `loadCatalog` ~line 854; `buildLedger` ~line 444)

- [ ] **Step 1: CSS** — add after the `.watch-empty` rule:

```css
.evid{margin-top:9px;border-top:1px dashed var(--line-soft);padding-top:7px}
.evid a{display:block;font-size:10.5px;color:var(--dim);text-decoration:none;line-height:1.5;margin-top:2px}
.evid a:hover{color:var(--txt)}
.evid a b{color:var(--amber);font-weight:500;margin-right:6px;font-size:9.5px}
.newbadge{display:inline-block;background:var(--amber-soft);border:1px solid var(--amber);color:var(--amber);font-family:"Archivo",sans-serif;font-size:8.5px;letter-spacing:.12em;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:1px}
```

- [ ] **Step 2: Carry evidence through loadCatalog** — in the `SIGNALS=j.signals.map(...)` line add `,evidence:Array.isArray(s.evidence)?s.evidence:[]` to the mapped object. Also add `evidence:[]` default in the embedded `SIGNALS` entries? No — embedded fallback stays as-is; `buildLedger` must tolerate `s.evidence` undefined.

- [ ] **Step 3: Render in buildLedger** — inside the pending-signal template, after `<div class="lnote">…</div>` insert:

```js
const ev=(s.evidence||[]).slice(0,3);
const lastSnap=journal.length?journal[journal.length-1].t:0;
const isNew=ev.some(e=>new Date(e.date+"T12:00:00Z").getTime()>lastSnap);
const evHtml=ev.length?`<div class="evid">${ev.map(e=>
  `<a href="${e.url}" target="_blank" rel="noopener"><b>${e.date.slice(5)}</b>${e.title}</a>`).join("")}</div>`:"";
```

and in the title line append `${isNew?'<span class="newbadge">novidade</span>':''}` after `${s.title}`. (Template becomes a map over a small builder function since it now needs statements — convert the `SIGNALS.map(s=>...)` arrow body from expression to block returning the string.)

- [ ] **Step 4: Verify** — `python3 -m http.server 8321 &` then open `http://localhost:8321/`; check: evidence links visible once signals.json has evidence (temporarily hand-add one fixture item, verify, revert); badge shows on first visit (no journal); old share hash `#v3.35-45-20.weights~y~70*qwen~u~x*ban~u~x*labs~u~x*waico~u~x*ipo~u~x*saturation~u~x.0.40-50-45` loads with weights CONFIRMADO and previsão 70%. Kill server.
- [ ] **Step 5: Commit** — `git add index.html && git commit -m "feat: render harvested evidence with novidade badge"`

---

### Task 5: Publish — repo, Pages, first live run

**Files:** none (operations)

- [ ] **Step 1:** `gh repo create ai-race-game --public --source . --push`
- [ ] **Step 2:** Enable Pages: `gh api -X POST repos/FrancyJGLisboa/ai-race-game/pages -f 'source[branch]=main' -f 'source[path]=/'`
- [ ] **Step 3:** First harvest: `gh workflow run harvest && sleep 60 && gh run list --workflow harvest -L1` — expect success; check whether a `chore: harvest evidence` commit appeared.
- [ ] **Step 4:** Verify live: `curl -sI https://francyjglisboa.github.io/ai-race-game/ | head -1` → `HTTP/2 200` (Pages can take a few minutes on first deploy; retry).
