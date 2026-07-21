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
    assert [e["url"] for e in ev] == ["https://example.com/k3-weights"]
    assert ev[0]["date"] == "2026-07-20"
    assert "_dt" not in ev[0]


def test_c1_noop_is_unchanged():
    cat = catalog()
    items = harvest.parse_items(FIXTURE_RSS)
    once, _ = harvest.harvest(cat, {"weights": items}, NOW)
    twice, changed = harvest.harvest(once, {"weights": items}, NOW)
    assert not changed and twice == once


def test_c4_resolved_untouched_and_skipped():
    cat = catalog()
    items = harvest.parse_items(FIXTURE_RSS)
    out, _ = harvest.harvest(cat, {"weights": items, "ipo": items}, NOW)
    ipo = next(s for s in out["signals"] if s["id"] == "ipo")
    assert ipo["resolved"] == "yes" and ipo["evidence"] == []
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
