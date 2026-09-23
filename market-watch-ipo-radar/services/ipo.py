"""IPO calendar data from Finnhub, enriched with market data from yfinance.

Finnhub's /calendar/ipo endpoint is the single source for both upcoming and
historical IPOs (it takes a from/to date range). Finnhub gives us the deal
facts - ticker, company, date, offer price, shares offered, exchange, status -
but not sector or post-IPO performance, so each row is enriched on demand with
yfinance lookups that are cached per ticker.
"""
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from statistics import median

import requests
import yfinance as yf

from .cache import cached, is_fresh, write

FINNHUB_IPO_URL = "https://finnhub.io/api/v1/calendar/ipo"

UPCOMING_TTL_SECONDS = 900               # 15 min
HISTORY_TTL_SECONDS = 60 * 60 * 12       # 12 h - past IPOs barely change
PROFILE_TTL_SECONDS = 60 * 60 * 24 * 7   # 7 d - sector/industry/first-month never change
QUOTE_TTL_SECONDS = 600                  # 10 min - the price is the part that moves
QUOTE_BULK_SIZE = 100      # tickers per bulk download request
QUOTE_BULK_MIN = 25        # below this, per-ticker fetching is simpler and fine
QUOTE_BULK_SLEEP = 0.4
QUOTE_BULK_ATTEMPTS = 3    # a bulk response can drop a live ticker; retry before giving up

CHUNK_DAYS = 90            # Finnhub is happier with modest date windows
FINNHUB_PAGE_CAP = 200     # the API silently truncates any response at 200 rows
MAX_SPLIT_DEPTH = 3        # halve a capped window this many times before giving up
FINNHUB_WORKERS = 4        # 20-odd calls finish in ~2s, far inside the 60/min budget
FIRST_MONTH_TRADING_DAYS = 21
SIX_MONTH_TRADING_DAYS = 126
MAX_HISTORY_YEARS = 10     # past this, timedelta overflows on absurd input
PRICE_WINDOW_DAYS = 280    # calendar days wide enough to contain 126 trading days
ENRICH_WORKERS = 8         # yfinance is network-bound; a few threads help a lot
CHART_TTL_SECONDS = 600    # 10 min, same as quotes

# Finnhub's candle endpoint is premium-only (403 on the free tier), so price
# series come from Yahoo Finance. Intraday intervals only reach back a few days,
# hence the coarser interval on the longer windows.
CHART_RANGES = {
    "1d": {"period": "1d", "interval": "5m", "label": "1 day"},
    "1w": {"period": "5d", "interval": "30m", "label": "1 week"},
    "1m": {"period": "1mo", "interval": "1d", "label": "1 month"},
    "3m": {"period": "3mo", "interval": "1d", "label": "3 months"},
    "6m": {"period": "6mo", "interval": "1d", "label": "6 months"},
    "ytd": {"period": "ytd", "interval": "1d", "label": "Year to date"},
    "1y": {"period": "1y", "interval": "1d", "label": "1 year"},
    "max": {"interval": "1d", "label": "All time"},
}


class MissingAPIKey(RuntimeError):
    pass


def _api_key():
    key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if not key or key == "your_key_here":
        raise MissingAPIKey(
            "FINNHUB_API_KEY is not set. Copy .env.example to .env and add your free "
            "Finnhub key (https://finnhub.io/register)."
        )
    return key


def _request_range(start_date, end_date):
    params = {"from": start_date, "to": end_date, "token": _api_key()}
    resp = requests.get(FINNHUB_IPO_URL, params=params, timeout=20)
    if resp.status_code == 401:
        raise MissingAPIKey("Finnhub rejected the API key (401). Check FINNHUB_API_KEY in .env.")
    if resp.status_code == 429:
        raise RuntimeError("Finnhub rate limit hit (429). Wait a minute and refresh.")
    resp.raise_for_status()
    return resp.json().get("ipoCalendar", []) or []


def _safe_float(value):
    """pandas/yfinance hand back NaN for gaps. Python's json module happily writes
    that as bare `NaN`, which browsers refuse to parse - so it becomes None here."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _parse_price(raw):
    """Finnhub's price field is a string: '17.00', '17.00-19.00', or ''."""
    if raw is None:
        return None
    nums = re.findall(r"\d+(?:\.\d+)?", str(raw))
    if not nums:
        return None
    # For a filing range, the high end is the closest thing to a headline price.
    return float(nums[-1])


# SPACs (blank-check shells) dominate raw IPO counts, almost all price at exactly
# $10.00, and never have a real sector - they'd drown out operating-company IPOs in
# any performance comparison, so they're flagged here and filterable in the UI.
SPAC_NAME_RE = re.compile(r"acquisition\s+(corp|company|co\b)|blank\s+check", re.IGNORECASE)


def _looks_like_spac(name, price, symbol):
    if name and SPAC_NAME_RE.search(name):
        return True
    # SPAC units price at exactly $10 and list under a 'U' (unit) or 'W' (warrant) suffix.
    if price == 10.0 and symbol and symbol.upper().endswith(("U", "W")):
        return True
    return False


def _normalize(raw):
    price = _parse_price(raw.get("price"))
    shares = _safe_float(raw.get("numberOfShares"))
    offer_size = price * shares if (price and shares) else None
    symbol = (raw.get("symbol") or "").strip() or None
    name = raw.get("name") or "Unknown"

    return {
        "symbol": symbol,
        "name": name,
        "is_spac": _looks_like_spac(name, price, symbol),
        "exchange": raw.get("exchange") or "Unknown",
        "ipo_date": raw.get("date"),
        "ipo_price": price,
        "price_raw": raw.get("price") or None,
        "shares_offered": shares,
        "offer_size": offer_size,
        "deal_status": (raw.get("status") or "unknown").lower(),
    }


def _fetch_window(start, end, cache_key, ttl, force_refresh=False):
    """Pull a date window from Finnhub in chunks, tolerating partial failures."""

    def _fetch_complete(window_start, window_end, depth=0):
        """Fetch a window, halving it when the response hits Finnhub's row cap.

        The API truncates at 200 rows without saying so. The late-2021 SPAC boom
        exceeds that in a single 90-day window, so a fixed chunk size silently
        loses IPOs; splitting until the response comes back under the cap is what
        makes the history complete.
        """
        rows = _request_range(window_start.isoformat(), window_end.isoformat())
        if len(rows) < FINNHUB_PAGE_CAP or depth >= MAX_SPLIT_DEPTH:
            return rows
        span = (window_end - window_start).days
        if span < 2:
            return rows
        mid = window_start + timedelta(days=span // 2)
        return (
            _fetch_complete(window_start, mid, depth + 1)
            + _fetch_complete(mid + timedelta(days=1), window_end, depth + 1)
        )

    def _fetch():
        windows = []
        cursor = start
        while cursor <= end:
            chunk_end = min(cursor + timedelta(days=CHUNK_DAYS), end)
            windows.append((cursor, chunk_end))
            cursor = chunk_end + timedelta(days=1)

        rows, warnings = [], []

        # Fetched concurrently rather than serially with a sleep between each:
        # ~20 calls land in about two seconds and stay well inside the free tier's
        # 60-per-minute allowance, instead of spending 20s asleep.
        def _one(window):
            return window, _fetch_complete(*window)

        with ThreadPoolExecutor(max_workers=FINNHUB_WORKERS) as pool:
            futures = [pool.submit(_one, w) for w in windows]
            for future in futures:
                try:
                    _window, chunk_rows = future.result()
                    rows.extend(chunk_rows)
                except MissingAPIKey:
                    raise
                except Exception as exc:
                    warnings.append(str(exc))

        seen, deduped = set(), []
        for raw in rows:
            row = _normalize(raw)
            key = (row["symbol"] or row["name"], row["ipo_date"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(row)

        deduped.sort(key=lambda r: r["ipo_date"] or "", reverse=True)
        return {"ipos": deduped, "warnings": warnings, "fetched_at": datetime.now().isoformat()}

    return cached(cache_key, ttl, _fetch, force_refresh=force_refresh)


def fetch_upcoming(days=60, force_refresh=False):
    # Local date, matching app.py and the browser. UTC would roll over a day
    # early each evening and hide IPOs pricing today.
    today = date.today()
    end = today + timedelta(days=days)
    payload = _fetch_window(today, end, f"ipo_upcoming_{days}d", UPCOMING_TTL_SECONDS, force_refresh)
    payload = dict(payload)
    payload["ipos"] = [r for r in payload["ipos"] if r["deal_status"] != "withdrawn"]
    payload["ipos"].sort(key=lambda r: r["ipo_date"] or "")
    return payload


def fetch_history(years=5, force_refresh=False):
    years = max(1, min(MAX_HISTORY_YEARS, years))
    today = date.today()
    start = today - timedelta(days=365 * years)
    payload = _fetch_window(start, today, f"ipo_history_{years}y", HISTORY_TTL_SECONDS, force_refresh)
    payload = dict(payload)
    payload["ipos"] = [r for r in payload["ipos"] if r["deal_status"] == "priced"]
    return payload


def _split_factor_since(ticker, ipo_date):
    """Undo Yahoo's back-adjustment of prices for splits that happened after listing.

    Yahoo restates historical closes so they're comparable to today's share count,
    but Finnhub's offer price is the original unadjusted figure. Comparing the two
    directly turns a failed micro-cap that did a 1-for-100 reverse split into a
    six-figure percentage gain. Multiplying the adjusted close back by every split
    since the IPO recovers the price the stock actually traded at.
    """
    try:
        splits = ticker.splits
        if splits is None or splits.empty:
            return 1.0
        listed_on = datetime.strptime(ipo_date, "%Y-%m-%d").date()
        factor = 1.0
        for timestamp, ratio in splits.items():
            ratio = _safe_float(ratio)
            if ratio and timestamp.date() >= listed_on:
                factor *= ratio
        return factor or 1.0
    except Exception:
        return 1.0


def _close_at(closes, offset):
    """Close `offset` trading days after listing, or None if it hasn't traded that long.

    Returning the latest available close instead would silently report, say, a
    five-day-old IPO's price as its "first month" return.
    """
    if offset >= len(closes):
        return None
    return _safe_float(closes.iloc[offset])


def _pct(from_price, to_price):
    if not from_price or to_price is None:
        return None
    return round((to_price - from_price) / from_price * 100, 2)


def _fetch_profile(symbol, ipo_date, ipo_price):
    """Facts that don't change once a company has listed, so they cache for a week."""
    result = {
        "sector": None,
        "industry": None,
        "shares_outstanding": None,
        "day1_close": None,
        "pct_change_day1": None,
        "pct_change_first_month": None,
        "pct_change_six_month": None,
        "pct_month1_vs_day1": None,
        "split_factor": 1.0,
        "profile_status": "ok",
    }

    try:
        ticker = yf.Ticker(symbol)

        try:
            info = ticker.get_info() or {}
        except Exception:
            info = {}
        result["sector"] = info.get("sector")
        result["industry"] = info.get("industry")
        result["shares_outstanding"] = _safe_float(info.get("sharesOutstanding"))

        if ipo_date and ipo_price:
            start = datetime.strptime(ipo_date, "%Y-%m-%d")
            window = ticker.history(
                start=start.strftime("%Y-%m-%d"),
                end=(start + timedelta(days=PRICE_WINDOW_DAYS)).strftime("%Y-%m-%d"),
            )
            if not window.empty:
                closes = window["Close"]
                factor = _split_factor_since(ticker, ipo_date)
                result["split_factor"] = factor

                def at(offset):
                    close = _close_at(closes, offset)
                    return round(close * factor, 4) if close is not None else None

                day1 = at(0)
                month1 = at(FIRST_MONTH_TRADING_DAYS)
                month6 = at(SIX_MONTH_TRADING_DAYS)

                result["day1_close"] = day1
                result["pct_change_day1"] = _pct(ipo_price, day1)
                result["pct_change_first_month"] = _pct(ipo_price, month1)
                result["pct_change_six_month"] = _pct(ipo_price, month6)
                # What a buyer at the day-one close (rather than the offer price,
                # which retail can't get) would have made by month end.
                result["pct_month1_vs_day1"] = _pct(day1, month1)

        if result["sector"] is None and result["pct_change_day1"] is None:
            result["profile_status"] = "no_market_data"
    except Exception as exc:
        result["profile_status"] = f"error: {exc}"

    return result


def _is_usable_profile(profile):
    """A delisted ticker legitimately has no data; a rate limit is a different thing."""
    return not str(profile.get("profile_status", "")).startswith("error")


def _fetch_quote(symbol):
    """Just the latest close.

    Split out from the profile so it can carry a short TTL: the dashboard
    recolours deals as prices move, which a 7-day profile cache would prevent.
    """
    # An empty frame is a real answer (delisted); an exception is not, so it
    # propagates and lets the cache serve the last good price instead.
    recent = yf.Ticker(symbol).history(period="5d")
    if recent.empty:
        return {"current_price": None}
    last_close = _safe_float(recent["Close"].iloc[-1])
    return {"current_price": round(last_close, 2) if last_close is not None else None}


EMPTY_ENRICHMENT = {
    "sector": None,
    "industry": None,
    "current_price": None,
    "pct_change_since_ipo": None,
    "pct_change_day1": None,
    "pct_change_first_month": None,
    "pct_change_six_month": None,
    "pct_month1_vs_day1": None,
    "day1_close": None,
    "est_market_cap_at_ipo": None,
}


def _enrich_row(row, force_refresh):
    out = dict(row)
    symbol = row.get("symbol")
    if not symbol:
        out.update(EMPTY_ENRICHMENT)
        out["enrichment_status"] = "no_symbol"
        return out

    ipo_date = row.get("ipo_date")
    ipo_price = row.get("ipo_price")

    try:
        # A forced refresh deliberately does not bust the profile cache: sector and
        # the day-1/month-1/six-month milestones are settled history. Only the
        # current price can actually have changed.
        profile = cached(
            f"profile_{symbol}_{ipo_date}",
            PROFILE_TTL_SECONDS,
            lambda: _fetch_profile(symbol, ipo_date, ipo_price),
            should_cache=_is_usable_profile,
        )
        quote = cached(
            f"quote_{symbol}",
            QUOTE_TTL_SECONDS,
            lambda: _fetch_quote(symbol),
            force_refresh=force_refresh,
        )
    except Exception as exc:
        out.update(EMPTY_ENRICHMENT)
        out["enrichment_status"] = f"error: {exc}"
        return out

    current_price = quote.get("current_price")
    shares_outstanding = profile.get("shares_outstanding")
    # One share bought at the offer price is `factor` shares today, so that's what
    # today's price has to be measured against (see _split_factor_since).
    factor = profile.get("split_factor") or 1.0
    if shares_outstanding and factor:
        shares_outstanding = shares_outstanding / factor

    out.update(
        {
            "sector": profile.get("sector"),
            "industry": profile.get("industry"),
            "current_price": current_price,
            "day1_close": profile.get("day1_close"),
            "pct_change_day1": profile.get("pct_change_day1"),
            "pct_change_first_month": profile.get("pct_change_first_month"),
            "pct_change_six_month": profile.get("pct_change_six_month"),
            "pct_month1_vs_day1": profile.get("pct_month1_vs_day1"),
            # Approximation: current share count x offer price. True at-IPO share
            # counts aren't in any free feed, so this is labelled "est." in the UI.
            "est_market_cap_at_ipo": (
                float(ipo_price) * shares_outstanding if ipo_price and shares_outstanding else None
            ),
            "pct_change_since_ipo": (
                round((current_price * factor - ipo_price) / ipo_price * 100, 2)
                if ipo_price and current_price
                else None
            ),
            "split_factor": factor,
        }
    )

    status = profile.get("profile_status", "ok")
    if current_price is None and profile.get("sector") is None:
        status = "no_market_data"
    out["enrichment_status"] = status
    return out


def prime_quotes(symbols, force_refresh=False):
    """Seed the per-symbol quote cache using bulk downloads.

    Asking Yahoo for 800 prices one ticker at a time reliably trips its rate
    limiter - in testing only 28 of 823 came back. yf.download takes a whole
    batch in a single request, so the same job becomes a handful of calls.

    Only real prices are written here. A bulk response can come back missing a
    symbol that is perfectly alive (RDDT and ARM both did), so an absent price
    is treated as unresolved and retried, never cached as "no data" - deciding
    a ticker is dead is left to the single-ticker path, which can tell an empty
    history from a failed request.
    """
    wanted = [s for s in dict.fromkeys(symbols) if s]
    pending = [s for s in wanted if force_refresh or not is_fresh(f"quote_{s}", QUOTE_TTL_SECONDS)]
    if len(pending) < QUOTE_BULK_MIN:
        return

    for attempt in range(QUOTE_BULK_ATTEMPTS):
        if not pending:
            return
        size = max(20, QUOTE_BULK_SIZE // (2 ** attempt))
        unresolved = []

        for start in range(0, len(pending), size):
            chunk = pending[start : start + size]
            try:
                frame = yf.download(
                    " ".join(chunk), period="5d", group_by="ticker",
                    threads=True, progress=False, auto_adjust=True,
                )
            except Exception:
                unresolved.extend(chunk)
                continue

            for symbol in chunk:
                price = None
                try:
                    closes = frame[symbol]["Close"].dropna()
                    if len(closes):
                        price = _safe_float(closes.iloc[-1])
                except (KeyError, TypeError, IndexError):
                    price = None

                if price is None:
                    unresolved.append(symbol)
                else:
                    write(f"quote_{symbol}", {"current_price": round(price, 2)})

            time.sleep(QUOTE_BULK_SLEEP)

        pending = unresolved


def enrich(rows, force_refresh=False, max_workers=ENRICH_WORKERS):
    """Attach sector + performance data to IPO rows.

    yfinance lookups are network-bound and slow (~2-4s per ticker), so they run in
    a small thread pool and every result is cached per ticker. Input order is kept.
    """
    if not rows:
        return []
    prime_quotes([r.get("symbol") for r in rows], force_refresh=force_refresh)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        return list(pool.map(lambda r: _enrich_row(r, force_refresh), rows))


def search_all(rows, query, limit=25):
    """Match a query against every IPO we hold, by ticker or company name."""
    needle = (query or "").strip().lower()
    if not needle:
        return []
    matches = [
        r for r in rows
        if needle in (r.get("symbol") or "").lower() or needle in (r.get("name") or "").lower()
    ]
    # Exact ticker first, then prefix matches, then the rest - newest first within each.
    def rank(row):
        symbol = (row.get("symbol") or "").lower()
        if symbol == needle:
            return 0
        if symbol.startswith(needle):
            return 1
        return 2

    def recency(row):
        digits = (row.get("ipo_date") or "").replace("-", "")
        return -int(digits) if digits.isdigit() else 0

    matches.sort(key=lambda r: (rank(r), recency(r)))
    return matches[:limit]


def fetch_chart(symbol, range_key, ipo_date=None, force_refresh=False):
    """Price series for one ticker over a named window.

    Closes are multiplied back by any splits since the IPO, so the chart is in the
    same terms as the offer price it gets compared against everywhere else.
    """
    spec = CHART_RANGES.get(range_key)
    if not spec:
        raise ValueError(f"Unknown range '{range_key}'")

    def _fetch():
        ticker = yf.Ticker(symbol)
        kwargs = {"interval": spec["interval"]}
        if "period" in spec:
            kwargs["period"] = spec["period"]
        elif ipo_date:
            kwargs["start"] = ipo_date
        else:
            kwargs["period"] = "max"

        try:
            hist = ticker.history(**kwargs)
        except Exception as exc:
            return {"points": [], "status": f"error: {exc}", "range": range_key}

        if hist.empty:
            return {"points": [], "status": "no_data", "range": range_key}

        factor = _split_factor_since(ticker, ipo_date) if ipo_date else 1.0
        points = []
        for timestamp, row in hist.iterrows():
            close = _safe_float(row.get("Close"))
            if close is None:
                continue
            points.append({"t": timestamp.isoformat(), "c": round(close * factor, 4)})

        if not points:
            return {"points": [], "status": "no_data", "range": range_key}

        closes = [p["c"] for p in points]
        first, last = closes[0], closes[-1]
        return {
            "status": "ok",
            "range": range_key,
            "label": spec["label"],
            "interval": spec["interval"],
            "points": points,
            "first": first,
            "last": last,
            "high": max(closes),
            "low": min(closes),
            "change_pct": round((last - first) / first * 100, 2) if first else None,
            "split_factor": factor,
        }

    return cached(
        f"chart_{symbol}_{range_key}",
        CHART_TTL_SECONDS,
        _fetch,
        force_refresh=force_refresh,
        should_cache=lambda d: not str(d.get("status", "")).startswith("error"),
    )


def _values(rows, field):
    return [r[field] for r in rows if r.get(field) is not None]


def _mean(values):
    return round(sum(values) / len(values), 2) if values else None


def _share_positive(values):
    """Percentage of values strictly above zero."""
    if not values:
        return None
    return round(sum(1 for v in values if v > 0) / len(values) * 100, 1)


def _extreme(rows, field, pick):
    candidates = [r for r in rows if r.get(field) is not None]
    if not candidates:
        return None
    row = pick(candidates, key=lambda r: r[field])
    return {
        "symbol": row.get("symbol"),
        "name": row.get("name"),
        "ipo_date": row.get("ipo_date"),
        "sector": row.get("sector") or "Unknown",
        "value": row[field],
    }


def _group_mean(rows, key_fn, field, min_count=1):
    groups = {}
    for row in rows:
        if row.get(field) is None:
            continue
        key = key_fn(row)
        if key:
            groups.setdefault(key, []).append(row[field])
    return [
        {"key": key, "count": len(values), "mean": _mean(values)}
        for key, values in groups.items()
        if len(values) >= min_count
    ]


def compute_general_metrics(enriched_rows, initial_investment=1000.0):
    """Every figure here is computed from fetched prices - nothing is estimated.

    Day 1 = close on the first trading day vs. the offer price.
    Month 1 = close 21 trading days in. Six months = 126 trading days in.
    IPOs too young to have reached a milestone are excluded from that metric
    rather than being measured against a shorter window.
    """
    since = _values(enriched_rows, "pct_change_since_ipo")
    day1 = _values(enriched_rows, "pct_change_day1")
    month1 = _values(enriched_rows, "pct_change_first_month")
    six_month = _values(enriched_rows, "pct_change_six_month")
    hold_from_day1 = _values(enriched_rows, "pct_month1_vs_day1")

    winners = [v for v in since if v > 0]
    losers = [v for v in since if v < 0]

    sector_day1 = sorted(
        _group_mean(enriched_rows, lambda r: r.get("sector") or "Unknown", "pct_change_day1", min_count=3),
        key=lambda g: g["mean"],
        reverse=True,
    )

    by_year = sorted(
        _group_mean(enriched_rows, lambda r: (r.get("ipo_date") or "")[:4], "pct_change_day1"),
        key=lambda g: g["key"],
    )

    # Equal-weight backtest: buy every IPO at its day-one close, sell at month end.
    # Equal weighting means the portfolio return is the mean of the individual returns.
    backtest = []
    for group in sorted(
        _group_mean(enriched_rows, lambda r: (r.get("ipo_date") or "")[:4], "pct_month1_vs_day1"),
        key=lambda g: g["key"],
    ):
        backtest.append(
            {
                "year": group["key"],
                "ipos": group["count"],
                "mean_return_pct": group["mean"],
                "invested": initial_investment,
                "final_value": round(initial_investment * (1 + group["mean"] / 100), 2),
                "profit": round(initial_investment * group["mean"] / 100, 2),
            }
        )

    return {
        "sample_size": len(enriched_rows),
        "counts": {
            "with_current_price": len(since),
            "with_day1": len(day1),
            "with_month1": len(month1),
            "with_six_month": len(six_month),
        },
        "win_rates": {
            "pct_net_gain_since_ipo": _share_positive(since),
            "pct_net_loss_since_ipo": (
                round(sum(1 for v in since if v < 0) / len(since) * 100, 1) if since else None
            ),
            "pct_up_day1": _share_positive(day1),
            "pct_up_month1": _share_positive(month1),
        },
        "returns": {
            "avg_day1_pct": _mean(day1),
            "avg_month1_pct": _mean(month1),
            "median_day1_pct": round(median(day1), 2) if day1 else None,
            "best_day1": _extreme(enriched_rows, "pct_change_day1", max),
            "worst_day1": _extreme(enriched_rows, "pct_change_day1", min),
        },
        "holding_period": {
            "avg_month1_from_day1_close_pct": _mean(hold_from_day1),
            "avg_six_month_pct": _mean(six_month),
            "pct_up_from_day1_close": _share_positive(hold_from_day1),
        },
        "risk_reward": {
            "winners": len(winners),
            "losers": len(losers),
            "win_loss_ratio": round(len(winners) / len(losers), 2) if losers else None,
            "avg_gain_of_winners_pct": _mean(winners),
            "avg_loss_of_losers_pct": _mean(losers),
            "payoff_ratio": (
                round(_mean(winners) / abs(_mean(losers)), 2) if winners and losers else None
            ),
        },
        "sector_day1": sector_day1,
        "year_over_year": by_year,
        "backtest": backtest,
    }


def compute_stats(enriched_rows, first_month_threshold=50.0):
    """Sector performance table + the 'popped more than X% in month one' list."""
    by_sector = {}
    for row in enriched_rows:
        pct = row.get("pct_change_since_ipo")
        if pct is None:
            continue
        by_sector.setdefault(row.get("sector") or "Unknown", []).append(pct)

    sector_performance = [
        {
            "sector": sector,
            "count": len(values),
            "avg_pct_change_since_ipo": round(sum(values) / len(values), 2),
            "median_pct_change_since_ipo": round(median(values), 2),
            "best": round(max(values), 2),
            "worst": round(min(values), 2),
        }
        for sector, values in by_sector.items()
    ]
    sector_performance.sort(key=lambda s: s["avg_pct_change_since_ipo"], reverse=True)

    first_month_winners = [
        {
            "symbol": r.get("symbol"),
            "name": r.get("name"),
            "ipo_date": r.get("ipo_date"),
            "ipo_price": r.get("ipo_price"),
            "sector": r.get("sector") or "Unknown",
            "pct_change_first_month": r.get("pct_change_first_month"),
            "pct_change_since_ipo": r.get("pct_change_since_ipo"),
        }
        for r in enriched_rows
        if r.get("pct_change_first_month") is not None
        and r["pct_change_first_month"] > first_month_threshold
    ]
    first_month_winners.sort(key=lambda r: r["pct_change_first_month"], reverse=True)

    scored = [r for r in enriched_rows if r.get("pct_change_since_ipo") is not None]
    winners = [r for r in scored if r["pct_change_since_ipo"] > 0]

    # The full sample, including deals that cleared no threshold and deals with no
    # usable price data - without this the only IPOs ever listed are the winners.
    all_ipos = [
        {
            "symbol": r.get("symbol"),
            "name": r.get("name"),
            "ipo_date": r.get("ipo_date"),
            "ipo_price": r.get("ipo_price"),
            "current_price": r.get("current_price"),
            "sector": r.get("sector") or "Unknown",
            "exchange": r.get("exchange"),
            "is_spac": r.get("is_spac"),
            "pct_change_day1": r.get("pct_change_day1"),
            "pct_change_first_month": r.get("pct_change_first_month"),
            "pct_change_since_ipo": r.get("pct_change_since_ipo"),
            "enrichment_status": r.get("enrichment_status"),
            "beat_threshold": (
                r.get("pct_change_first_month") is not None
                and r["pct_change_first_month"] > first_month_threshold
            ),
        }
        for r in enriched_rows
    ]
    all_ipos.sort(key=lambda r: r["ipo_date"] or "", reverse=True)

    return {
        "sample_size": len(enriched_rows),
        "scored_size": len(scored),
        "pct_trading_above_ipo_price": round(len(winners) / len(scored) * 100, 1) if scored else None,
        "sector_performance": sector_performance,
        "first_month_threshold": first_month_threshold,
        "first_month_winners": first_month_winners,
        "all_ipos": all_ipos,
    }
