"""Federal Reserve data pulled straight from the Fed's own public RSS feeds.

No API key required. These are the official syndication feeds the Fed publishes
for its own press releases, so there's no scraping / ToS concern.
"""
import re
from html.parser import HTMLParser

import feedparser
import requests

from .cache import cached

MONETARY_POLICY_FEED = "https://www.federalreserve.gov/feeds/press_monetary.xml"
ALL_PRESS_FEED = "https://www.federalreserve.gov/feeds/press_all.xml"

CACHE_TTL_SECONDS = 1800  # Fed announcements don't change minute to minute


class _ParagraphExtractor(HTMLParser):
    """Pull the body paragraphs out of a federalreserve.gov press release page.

    The RSS <summary> for FOMC statements is just the headline repeated, so the
    actual statement text has to come from the release page itself.
    """

    def __init__(self):
        super().__init__()
        self.paragraphs = []
        self._depth = 0
        self._buffer = []

    def handle_starttag(self, tag, attrs):
        if tag == "p":
            self._depth += 1
            self._buffer = []

    def handle_endtag(self, tag):
        if tag == "p" and self._depth:
            self._depth -= 1
            text = re.sub(r"\s+", " ", "".join(self._buffer)).strip()
            if text:
                self.paragraphs.append(text)
            self._buffer = []

    def handle_data(self, data):
        if self._depth:
            self._buffer.append(data)


BOILERPLATE = re.compile(
    r"^(last update|for (media )?(release|inquiries)|share$|board of governors|implementation note)",
    re.IGNORECASE,
)

# Site chrome that appears on every federalreserve.gov page, above the actual release.
SITE_CHROME = re.compile(
    r"secure \.gov websites|padlock|official website of the United States"
    r"|central bank of the United States, provides the nation",
    re.IGNORECASE,
)


def _fetch_statement_text(url, max_paragraphs=3, max_chars=1400):
    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": "MarketWatchAndIPORadar/1.0"})
        resp.raise_for_status()
        parser = _ParagraphExtractor()
        parser.feed(resp.text)
        body = [
            p for p in parser.paragraphs
            if len(p) > 120 and not BOILERPLATE.match(p) and not SITE_CHROME.search(p)
        ]
        if not body:
            return None
        return " ".join(body[:max_paragraphs])[:max_chars]
    except Exception:
        return None


def _entry_to_dict(entry, summary_chars=None):
    summary = entry.get("summary", "") or ""
    if summary_chars:
        summary = summary[:summary_chars]
    return {
        "title": entry.get("title", ""),
        "date": entry.get("published", ""),
        "link": entry.get("link", ""),
        "summary": summary,
    }


def get_fed_data(limit=8, force_refresh=False):
    def _fetch():
        result = {
            "status": "ok",
            "latest_fomc_summary": None,
            "recent_announcements": [],
            "errors": [],
        }

        try:
            monetary = feedparser.parse(MONETARY_POLICY_FEED)
            if getattr(monetary, "bozo", 0) and not monetary.entries:
                raise ValueError(monetary.get("bozo_exception", "feed parse failed"))
            if monetary.entries:
                latest = _entry_to_dict(monetary.entries[0], summary_chars=800)
                # The feed's own summary is usually just the headline again; prefer
                # the real statement text when we can pull it off the release page.
                if latest["link"]:
                    full_text = _fetch_statement_text(latest["link"])
                    if full_text:
                        latest["summary"] = full_text
                        latest["summary_source"] = "press release body"
                if latest["summary"].strip().lower() == latest["title"].strip().lower():
                    latest["summary"] = ""
                result["latest_fomc_summary"] = latest
        except Exception as exc:
            result["errors"].append(f"monetary policy feed: {exc}")

        try:
            all_press = feedparser.parse(ALL_PRESS_FEED)
            if getattr(all_press, "bozo", 0) and not all_press.entries:
                raise ValueError(all_press.get("bozo_exception", "feed parse failed"))
            result["recent_announcements"] = [_entry_to_dict(e) for e in all_press.entries[:limit]]
        except Exception as exc:
            result["errors"].append(f"press feed: {exc}")

        if result["latest_fomc_summary"] is None and not result["recent_announcements"]:
            result["status"] = "error"

        return result

    return cached("fed_data", CACHE_TTL_SECONDS, _fetch, force_refresh=force_refresh)
