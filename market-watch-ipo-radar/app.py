"""Market Watch and IPO Radar - a Flask backend for an IPO-focused market dashboard.

Run with:  python app.py   ->  http://127.0.0.1:5000

All third-party API calls happen here on the server, so the Finnhub key in .env
is never exposed to the browser.
"""
import os
from datetime import date, timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

from services import cache, fed, indices, ipo  # noqa: E402  (must load .env first)

app = Flask(__name__, static_folder="static", static_url_path="/static")

DEFAULT_HISTORY_YEARS = 5
UPCOMING_WINDOW_DAYS = 120
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
DEFAULT_STATS_SAMPLE = 100
GENERAL_TTL_SECONDS = 60 * 60 * 6   # the full-population snapshot is expensive; 6 h
CALENDAR_ENRICH_LIMIT = 250


def _wants_refresh():
    return request.args.get("refresh", "false").lower() == "true"


def _matches_query(row, query):
    """Case-insensitive substring match on ticker or company name."""
    if not query:
        return True
    needle = query.strip().lower()
    if not needle:
        return True
    return needle in (row.get("symbol") or "").lower() or needle in (row.get("name") or "").lower()


@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/health")
def api_health():
    return jsonify(
        {
            "status": "ok",
            "finnhub_key_configured": bool(os.environ.get("FINNHUB_API_KEY", "").strip())
            and os.environ.get("FINNHUB_API_KEY") != "your_key_here",
        }
    )


@app.route("/api/indices")
def api_indices():
    rows = indices.get_all_indices(force_refresh=_wants_refresh())
    failed = [r for r in rows if r["status"] == "error"]
    return jsonify(
        {
            "status": "ok" if not failed else ("error" if len(failed) == len(rows) else "partial"),
            "indices": rows,
        }
    )


@app.route("/api/fed")
def api_fed():
    return jsonify(fed.get_fed_data(force_refresh=_wants_refresh()))


@app.route("/api/ipo/upcoming")
def api_ipo_upcoming():
    days = request.args.get("days", default=90, type=int)
    start = request.args.get("start")
    end = request.args.get("end")

    try:
        payload = fetch_with_guard(lambda: ipo.fetch_upcoming(days=days, force_refresh=_wants_refresh()))
    except ApiError as exc:
        return jsonify(exc.payload), exc.http_status

    rows = payload["ipos"]
    if start:
        rows = [r for r in rows if (r["ipo_date"] or "") >= start]
    if end:
        rows = [r for r in rows if (r["ipo_date"] or "") <= end]

    return jsonify(
        {
            "status": "ok",
            "count": len(rows),
            "window_days": days,
            "warnings": payload.get("warnings", []),
            "fetched_at": payload.get("fetched_at"),
            "ipos": rows,
        }
    )


@app.route("/api/ipo/coverage")
def api_ipo_coverage():
    """The real date bounds of the data, so the UI can't offer ranges we can't fill."""
    try:
        history = fetch_with_guard(lambda: ipo.fetch_history(years=DEFAULT_HISTORY_YEARS))
        upcoming = fetch_with_guard(lambda: ipo.fetch_upcoming(days=UPCOMING_WINDOW_DAYS))
    except ApiError as exc:
        return jsonify(exc.payload), exc.http_status

    past_dates = [r["ipo_date"] for r in history["ipos"] if r["ipo_date"]]
    future_dates = [r["ipo_date"] for r in upcoming["ipos"] if r["ipo_date"]]
    today = date.today().isoformat()

    latest_priced = max(past_dates) if past_dates else today
    return jsonify(
        {
            "status": "ok",
            "earliest": min(past_dates) if past_dates else today,
            # The calendar runs to the furthest scheduled deal; history stops at the
            # last deal that actually priced.
            "latest": max(future_dates + [latest_priced]),
            "latest_priced": latest_priced,
            "today": today,
            "priced_count": len(past_dates),
            "upcoming_count": len(future_dates),
        }
    )


@app.route("/api/ipo/calendar")
def api_ipo_calendar():
    """Priced and upcoming deals merged into one date-ranged calendar feed.

    Finnhub only ever carries a handful of genuinely upcoming deals, so a
    future-only calendar is nearly empty. Recently priced IPOs are what make it
    a usable calendar.
    """
    today = date.today()
    start = request.args.get("start") or (today - timedelta(days=30)).isoformat()
    end = request.args.get("end") or (today + timedelta(days=30)).isoformat()

    try:
        history = fetch_with_guard(lambda: ipo.fetch_history(years=DEFAULT_HISTORY_YEARS))
        upcoming = fetch_with_guard(lambda: ipo.fetch_upcoming(days=UPCOMING_WINDOW_DAYS))
    except ApiError as exc:
        return jsonify(exc.payload), exc.http_status

    seen, rows = set(), []
    for row in list(upcoming["ipos"]) + list(history["ipos"]):
        ipo_date = row.get("ipo_date")
        if not ipo_date or not (start <= ipo_date <= end):
            continue
        key = (row.get("symbol") or row.get("name"), ipo_date)
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)

    if request.args.get("exclude_spacs", "false").lower() == "true":
        rows = [r for r in rows if not r.get("is_spac")]

    rows = [r for r in rows if _matches_query(r, request.args.get("q"))]
    rows.sort(key=lambda r: r["ipo_date"])
    warnings = history.get("warnings", []) + upcoming.get("warnings", [])

    # Priced deals get current prices so the calendar can colour them by whether
    # they're above or below their offer price. Guarded by a cap: a multi-year
    # range would otherwise mean thousands of Yahoo Finance lookups.
    priced = [r for r in rows if r["deal_status"] == "priced"]
    enriched = len(priced) <= CALENDAR_ENRICH_LIMIT
    if enriched and priced:
        by_key = {
            (r.get("symbol"), r.get("ipo_date")): r
            for r in ipo.enrich(priced, force_refresh=_wants_refresh())
        }
        rows = [by_key.get((r.get("symbol"), r.get("ipo_date")), r) for r in rows]

    return jsonify(
        {
            "status": "ok",
            "start": start,
            "end": end,
            "count": len(rows),
            "upcoming_count": sum(1 for r in rows if r["deal_status"] != "priced"),
            "priced_count": len(priced),
            "performance_loaded": enriched,
            "enrich_limit": CALENDAR_ENRICH_LIMIT,
            "warnings": warnings,
            "ipos": rows,
        }
    )


@app.route("/api/ipo/detail")
def api_ipo_detail():
    """Full detail for one deal, enriched on demand."""
    symbol = request.args.get("symbol")
    ipo_date = request.args.get("date")
    name = request.args.get("name")
    if not (symbol or name):
        return jsonify({"status": "error", "error": "symbol or name is required"}), 400

    try:
        history = fetch_with_guard(lambda: ipo.fetch_history(years=DEFAULT_HISTORY_YEARS))
        upcoming = fetch_with_guard(lambda: ipo.fetch_upcoming(days=UPCOMING_WINDOW_DAYS))
    except ApiError as exc:
        return jsonify(exc.payload), exc.http_status

    match = None
    for row in list(upcoming["ipos"]) + list(history["ipos"]):
        same_deal = (symbol and row.get("symbol") == symbol) or (not symbol and row.get("name") == name)
        if same_deal and (not ipo_date or row.get("ipo_date") == ipo_date):
            match = row
            break

    if match is None:
        return jsonify({"status": "error", "error": "That IPO isn't in the loaded data."}), 404

    return jsonify({"status": "ok", "ipo": ipo.enrich([match])[0]})


@app.route("/api/ipo/search")
def api_ipo_search():
    """Searchable list of every IPO we hold - priced history plus upcoming deals."""
    query = request.args.get("q", "")
    if not query.strip():
        return jsonify({"status": "ok", "count": 0, "results": []})

    try:
        history = fetch_with_guard(lambda: ipo.fetch_history(years=DEFAULT_HISTORY_YEARS))
        upcoming = fetch_with_guard(lambda: ipo.fetch_upcoming(days=UPCOMING_WINDOW_DAYS))
    except ApiError as exc:
        return jsonify(exc.payload), exc.http_status

    everything = list(upcoming["ipos"]) + list(history["ipos"])
    results = ipo.search_all(everything, query)

    return jsonify(
        {
            "status": "ok",
            "count": len(results),
            "searched": len(everything),
            "results": [
                {
                    "symbol": r.get("symbol"),
                    "name": r.get("name"),
                    "ipo_date": r.get("ipo_date"),
                    "exchange": r.get("exchange"),
                    "is_spac": r.get("is_spac"),
                    "deal_status": r.get("deal_status"),
                }
                for r in results
            ],
        }
    )


@app.route("/api/ipo/chart")
def api_ipo_chart():
    """Price series for one ticker over a named window."""
    symbol = request.args.get("symbol")
    range_key = request.args.get("range", "max")
    if not symbol:
        return jsonify({"status": "error", "error": "symbol is required"}), 400
    if range_key not in ipo.CHART_RANGES:
        return jsonify({"status": "error", "error": f"Unknown range '{range_key}'"}), 400

    ipo_date = request.args.get("date")
    if not ipo_date:
        try:
            history = fetch_with_guard(lambda: ipo.fetch_history(years=DEFAULT_HISTORY_YEARS))
            match = next((r for r in history["ipos"] if r.get("symbol") == symbol), None)
            ipo_date = match.get("ipo_date") if match else None
        except ApiError:
            ipo_date = None

    payload = ipo.fetch_chart(symbol, range_key, ipo_date, force_refresh=_wants_refresh())
    payload["symbol"] = symbol
    payload["ipo_date"] = ipo_date
    payload["ranges"] = [{"key": k, "label": v["label"]} for k, v in ipo.CHART_RANGES.items()]
    return jsonify(payload)


@app.route("/api/ipo/history")
def api_ipo_history():
    years = request.args.get("years", default=DEFAULT_HISTORY_YEARS, type=int)
    exchange = request.args.get("exchange")
    sector = request.args.get("sector")
    page = max(1, request.args.get("page", default=1, type=int))
    page_size = min(MAX_PAGE_SIZE, max(1, request.args.get("page_size", default=DEFAULT_PAGE_SIZE, type=int)))
    start = request.args.get("start")
    end = request.args.get("end")

    try:
        payload = fetch_with_guard(lambda: ipo.fetch_history(years=years, force_refresh=_wants_refresh()))
    except ApiError as exc:
        return jsonify(exc.payload), exc.http_status

    all_rows = payload["ipos"]
    exchanges = sorted({r["exchange"] for r in all_rows if r["exchange"]})

    rows = all_rows
    if request.args.get("exclude_spacs", "false").lower() == "true":
        rows = [r for r in rows if not r.get("is_spac")]
    rows = [r for r in rows if _matches_query(r, request.args.get("q"))]
    if exchange and exchange != "All":
        rows = [r for r in rows if r["exchange"] == exchange]
    if start:
        rows = [r for r in rows if (r["ipo_date"] or "") >= start]
    if end:
        rows = [r for r in rows if (r["ipo_date"] or "") <= end]

    total = len(rows)
    page_rows = rows[(page - 1) * page_size : (page - 1) * page_size + page_size]
    enriched = ipo.enrich(page_rows)

    # Sector is only known after enrichment, so it filters the visible page.
    if sector and sector != "All":
        enriched = [r for r in enriched if (r.get("sector") or "Unknown") == sector]

    return jsonify(
        {
            "status": "ok",
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, -(-total // page_size)),
            "exchanges": exchanges,
            "years": years,
            "warnings": payload.get("warnings", []),
            "fetched_at": payload.get("fetched_at"),
            "ipos": enriched,
        }
    )


@app.route("/api/ipo/stats")
def api_ipo_stats():
    years = request.args.get("years", default=DEFAULT_HISTORY_YEARS, type=int)
    sample = min(300, max(1, request.args.get("sample", default=DEFAULT_STATS_SAMPLE, type=int)))
    threshold = request.args.get("threshold", default=50.0, type=float)

    try:
        payload = fetch_with_guard(lambda: ipo.fetch_history(years=years, force_refresh=False))
    except ApiError as exc:
        return jsonify(exc.payload), exc.http_status

    exclude_spacs = request.args.get("exclude_spacs", "true").lower() == "true"
    candidates = [r for r in payload["ipos"] if not (exclude_spacs and r.get("is_spac"))]

    rows = candidates[:sample]  # most recent N priced IPOs
    enriched = ipo.enrich(rows)
    stats = ipo.compute_stats(enriched, first_month_threshold=threshold)
    stats.update(
        {
            "status": "ok",
            "years": years,
            "excluded_spacs": exclude_spacs,
            "spacs_in_window": sum(1 for r in payload["ipos"] if r.get("is_spac")),
            "total_available": len(candidates),
            "warnings": payload.get("warnings", []),
        }
    )
    return jsonify(stats)


@app.route("/api/ipo/general")
def api_ipo_general():
    """Aggregate 'is investing in IPOs a winning strategy?' metrics.

    Computed over every IPO in the window rather than a sample. That means a few
    hundred price lookups, so the finished snapshot is cached - it only moves when
    new deals list or prices shift, and a manual refresh forces a recompute.
    """
    years = request.args.get("years", default=DEFAULT_HISTORY_YEARS, type=int)
    exclude_spacs = request.args.get("exclude_spacs", "true").lower() == "true"

    try:
        payload = fetch_with_guard(lambda: ipo.fetch_history(years=years))
    except ApiError as exc:
        return jsonify(exc.payload), exc.http_status

    population = [r for r in payload["ipos"] if not (exclude_spacs and r.get("is_spac"))]

    def _compute():
        enriched = ipo.enrich(population, force_refresh=_wants_refresh())
        result = ipo.compute_general_metrics(enriched)
        result.update(
            {
                "status": "ok",
                "years": years,
                "excluded_spacs": exclude_spacs,
                "population": len(population),
                "total_priced": len(payload["ipos"]),
                "spacs_excluded": len(payload["ipos"]) - len(population),
                "computed_at": date.today().isoformat(),
                "warnings": payload.get("warnings", []),
            }
        )
        return result

    metrics = cache.cached(
        f"general_metrics_{years}y_{'nospac' if exclude_spacs else 'all'}",
        GENERAL_TTL_SECONDS,
        _compute,
        force_refresh=_wants_refresh(),
        should_cache=lambda d: d.get("counts", {}).get("with_day1", 0) > 0,
    )
    return jsonify(metrics)


@app.route("/api/cache/clear", methods=["POST"])
def api_cache_clear():
    prefix = request.json.get("prefix") if request.is_json else None
    removed = cache.clear_cache(prefix)
    return jsonify({"status": "ok", "files_removed": removed})


class ApiError(Exception):
    def __init__(self, payload, http_status):
        super().__init__(payload.get("error"))
        self.payload = payload
        self.http_status = http_status


def fetch_with_guard(fn):
    """Translate data-layer failures into structured JSON the frontend can render."""
    try:
        return fn()
    except ipo.MissingAPIKey as exc:
        raise ApiError(
            {"status": "error", "error_type": "missing_api_key", "error": str(exc), "ipos": []}, 503
        )
    except Exception as exc:
        raise ApiError(
            {"status": "error", "error_type": "upstream_failure", "error": str(exc), "ipos": []}, 502
        )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  Market Watch and IPO Radar running at http://127.0.0.1:{port}\n")
    app.run(debug=True, port=port)
