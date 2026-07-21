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
            except OSError as e:  # one dead query must not kill the run
                print(f"warn: {s['id']} query {q!r}: {e}", file=sys.stderr)
        if items:
            fetched[s["id"]] = items
    merged, changed = harvest(catalog, fetched, now)
    wrote = write_if_changed(path, merged, changed, now.date().isoformat())
    print("changed" if wrote else "unchanged")


if __name__ == "__main__":
    main()
