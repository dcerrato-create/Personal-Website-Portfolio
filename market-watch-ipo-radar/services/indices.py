"""Macro index data via yfinance.

Note on tickers: Yahoo Finance doesn't reliably carry the true "Wilshire 5000"
or "MSCI World" index tickers, so total-market / world / emerging-markets
exposure is approximated with liquid, widely-tracked ETFs instead. This is a
deliberate simplification, documented here and in the README.
"""
import math

import yfinance as yf

from .cache import cached

INDICES = [
    {"symbol": "^GSPC", "label": "S&P 500", "kind": "index"},
    {"symbol": "^IXIC", "label": "Nasdaq Composite", "kind": "index"},
    {"symbol": "^DJI", "label": "Dow Jones Industrial Average", "kind": "index"},
    {"symbol": "VTI", "label": "Total US Stock Market (VTI)", "kind": "etf_proxy"},
    {"symbol": "VT", "label": "Total World Stock Market (VT)", "kind": "etf_proxy"},
    {"symbol": "VWO", "label": "Emerging Markets (VWO)", "kind": "etf_proxy"},
]

CACHE_TTL_SECONDS = 60


def _usable(value):
    """A finite float, or None.

    `fast_info` returns NaN rather than None for some tickers - the VTI/VT/VWO
    ETFs here did exactly that. Folding NaN into None matters twice over: it lets
    an unusable quote fall through to the history fallback instead of failing the
    row outright, and it keeps NaN out of the JSON, which browsers cannot parse.
    """
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _fetch_one(symbol, label, kind):
    try:
        ticker = yf.Ticker(symbol)
        price = None
        prev_close = None
        try:
            fi = ticker.fast_info
            price = _usable(fi.get("last_price"))
            prev_close = _usable(fi.get("previous_close"))
        except Exception:
            pass

        if price is None or prev_close is None:
            hist = ticker.history(period="5d")
            # The most recent row can carry a NaN close for an unsettled session -
            # the VTI/VT/VWO ETFs do this while the index tickers do not - so drop
            # the gaps and take the last two rows that actually have a price.
            closes = hist["Close"].dropna() if not hist.empty else hist
            if len(closes) < 2:
                raise ValueError(f"no usable price history returned for {symbol}")
            price = _usable(closes.iloc[-1])
            prev_close = _usable(closes.iloc[-2])

        if price is None or prev_close is None or prev_close == 0:
            raise ValueError(f"unusable price data for {symbol}")

        change_pct = (price - prev_close) / prev_close * 100
        return {
            "symbol": symbol,
            "label": label,
            "kind": kind,
            "price": round(float(price), 2),
            "previous_close": round(float(prev_close), 2),
            "change_pct": round(change_pct, 2),
            "status": "ok",
        }
    except Exception as exc:
        return {
            "symbol": symbol,
            "label": label,
            "kind": kind,
            "price": None,
            "previous_close": None,
            "change_pct": None,
            "status": "error",
            "error": str(exc),
        }


def get_all_indices(force_refresh=False):
    def _fetch():
        return [_fetch_one(i["symbol"], i["label"], i["kind"]) for i in INDICES]

    return cached(
        "indices_snapshot",
        CACHE_TTL_SECONDS,
        _fetch,
        force_refresh=force_refresh,
        # A snapshot where every ticker errored is a transient upstream problem,
        # not data - caching it would blank the tiles for the full TTL.
        should_cache=lambda rows: any(r["status"] == "ok" for r in rows),
    )
