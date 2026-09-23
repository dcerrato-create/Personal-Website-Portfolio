"""Simple file-based cache so refreshes don't hammer Finnhub/yfinance rate limits.

Each key maps to a JSON file on disk holding {"ts": <unix time>, "data": <payload>}.
"""
import json
import os
import time

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache_data")
os.makedirs(CACHE_DIR, exist_ok=True)


def _path(key):
    safe = "".join(c if c.isalnum() or c in "_-." else "_" for c in key)
    return os.path.join(CACHE_DIR, f"{safe}.json")


def cached(key, ttl_seconds, fetch_fn, force_refresh=False, should_cache=None):
    """Return cached data for `key` if fresh, otherwise call fetch_fn() and store the result.

    A failure in fetch_fn re-raises after trying to serve stale cache as a fallback,
    so a temporary API outage doesn't blank out a screen that already had data.

    `should_cache` guards against persisting a failure. Upstreams rate limit, and a
    result that merely *represents* an error must not be written - a profile caches
    for a week, so one rate-limited moment would otherwise look broken for days.
    Stale data beats cached failure, so the previous value is served when available.
    """
    path = _path(key)
    if not force_refresh and os.path.exists(path):
        try:
            with open(path) as f:
                payload = json.load(f)
            if time.time() - payload["ts"] < ttl_seconds:
                return payload["data"]
        except (json.JSONDecodeError, KeyError, OSError):
            pass

    def _stale():
        if os.path.exists(path):
            try:
                with open(path) as f:
                    return json.load(f)["data"], True
            except (json.JSONDecodeError, KeyError, OSError):
                pass
        return None, False

    try:
        data = fetch_fn()
    except Exception:
        stale, found = _stale()
        if found:
            return stale
        raise

    if should_cache is not None and not should_cache(data):
        stale, found = _stale()
        return stale if found else data

    try:
        with open(path, "w") as f:
            json.dump({"ts": time.time(), "data": data}, f)
    except OSError:
        pass
    return data


def is_fresh(key, ttl_seconds):
    """True when a cache entry exists and is still inside its TTL."""
    path = _path(key)
    if not os.path.exists(path):
        return False
    try:
        with open(path) as f:
            return time.time() - json.load(f)["ts"] < ttl_seconds
    except (json.JSONDecodeError, KeyError, OSError):
        return False


def write(key, data):
    """Seed an entry directly, for values fetched outside the `cached` path."""
    try:
        with open(_path(key), "w") as f:
            json.dump({"ts": time.time(), "data": data}, f)
    except OSError:
        pass


def clear_cache(prefix=None):
    removed = 0
    for fname in os.listdir(CACHE_DIR):
        if prefix is None or fname.startswith(prefix):
            os.remove(os.path.join(CACHE_DIR, fname))
            removed += 1
    return removed
