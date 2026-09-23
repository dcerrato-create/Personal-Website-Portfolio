# Prompt Log — Market Watch and IPO Radar (HW3)

Tool used: **Claude Code** (Claude Sonnet 5 / Opus 5), single working session, ~22 Sep 2026.

This log records the prompts that actually shaped the project, the decisions I made rather than
the AI, and the places the AI's first attempt was wrong.

---

## 1. The opening prompt

I gave Claude the HW3 assignment PDF plus a full spec of what I wanted:

> I want to build an IPO-focused market dashboard that's unique — something you can't get from the
> stock app or Yahoo Finance. It should pull real market data and let me explore IPOs in depth.
>
> [...] Macro Market Overview: real-time prices + daily % change + close price for 3 major indices,
> total US equities, total world, emerging markets. Most recent official Fed summary + recent
> announcements. Refresh button + auto-refresh (no page reload).
>
> IPO Focus (Main Feature): Upcoming IPOs with full calendar view filterable by date range. IPO
> history, last 5 years, filterable by market. Data per IPO: ticker, company name, IPO date, IPO
> price, market cap at IPO, % change since IPO, sector. Comparisons: performance by sector, IPOs
> that gained >50% in first month.
>
> Python backend (no API key exposure in browser). Output as an interactive tool that opens
> separately from my portfolio site. Handle edge cases (missing data, API failures).

**What worked:** giving the whole spec up front instead of drip-feeding features. Claude designed
the caching and threading strategy around the full picture — if I'd asked for the history table
first and the analysis tab later, the per-ticker cache probably wouldn't have existed and the
analysis tab would have been unusably slow.

## 2. Decisions I made, not the AI

Claude stopped and asked before building, which I'd rather it did than guess:

**IPO data source.** It offered Finnhub vs. Alpha Vantage and explained the tradeoff: Alpha
Vantage's IPO endpoint only returns ~3 months of *upcoming* deals, so "5 years of history" would
have meant hardcoding a curated list — fake depth. Finnhub's `/calendar/ipo` takes a from/to range
covering both past and future. **I chose Finnhub**, and that decision is why the history tab has
1,395 real deals in it.

**Framework.** Flask + vanilla JS vs. Streamlit. Streamlit would have been faster to build, but it
hides the routing and refresh logic — and this course grades whether I can explain my own code in
an oral eval. **I chose Flask** so the refresh mechanism is something I actually wrote.

**Where the key lives.** I pasted my Finnhub key into chat; Claude flagged that it was now in the
transcript and suggested regenerating it later, and put it in a gitignored `.env` rather than
anywhere in the source.

## 3. Where the AI was wrong

Worth recording, because "the AI wrote it" is not the same as "it worked."

**yfinance returned nothing at all.** The first dependency list pinned `yfinance==0.2.44`. Every
single ticker failed with `Expecting value: line 1 column 1` — Yahoo now requires a cookie/crumb
handshake that old versions don't do. Nothing in the code was wrong; the pin was. Fixed by
upgrading to 1.2.0. **Lesson: a confidently-written `requirements.txt` is still a guess about the
outside world.** Claude only found this because we ran the code instead of trusting it.

**A bug that only appeared in the browser.** The history tab showed "Server returned a non-JSON
response (HTTP 200)" while `curl` returned what looked like perfectly good JSON. The cause: pandas
hands back `NaN` for missing prices, and Python's `json` module happily writes bare `NaN` — which
is invalid JSON that browsers refuse to parse, while Python's own parser accepts it. Invisible from
the server side. Fixed with a `_safe_float()` helper that converts non-finite values to `None`.

**The API was quietly lying and the code believed it.** Finnhub truncates any response at 200 rows
with no error and no "there is more" flag. My 90-day chunking looked like sensible caution, but the
late-2021 SPAC boom exceeds 200 IPOs in a quarter, so that one window came back capped and the
history was short by 106 deals — and started two months later than it should have. Nothing looked
broken; the number just happened to be 1,395 instead of 1,501. It only surfaced because I went
looking for a speed win and probed how the API behaved at different date ranges. **Lesson: an API
that returns HTTP 200 and well-formed JSON can still be giving you an incomplete answer.**

**Chart label collision.** The first sector chart drew the longest bar's value label straight
through the sector name next to it. Only visible in a screenshot — the code ran fine. Fixed by
reserving label space in the bar scale.

**A wrong median.** `sorted(values)[len(values) // 2]` returns the upper value for even-length
lists, so a two-IPO sector reported its better result as the "median." Replaced with
`statistics.median`.

## 4. The prompt that most improved the project

After the first live history fetch, I looked at the output and noticed the recent rows were all
"Acquisition Corp" companies priced at exactly $10.00. That's a domain observation, not a coding
one — and it led to the SPAC filter, which is the feature that makes the analysis tab mean
anything. 572 of 1,395 listings were blank-check shells; leaving them in dragged every sector
average toward zero.

This is the part I'd point to if asked what I contributed: **the AI built what I asked for
correctly, but it couldn't tell me that the data I'd asked for was mostly noise.** Reading the
actual output and recognizing the SPAC pattern was the judgment call, and the code change that
followed was small.

## 5. Verification

Everything was run before being called done: all six indices fetched live, the Fed feed parsed,
1,395 IPOs pulled from Finnhub, enrichment tested against real tickers (ARM +533% since IPO, RDDT
+366%) and against deliberate edge cases (a fake ticker, an IPO with no symbol yet). The UI was
screenshotted in a real browser in both light and dark mode, and refresh/auto-refresh/tab-switching
were driven programmatically to check for console errors.

---

## 6. My reflection

> **Write this yourself — do not use AI for this section.** Course policy is explicit that
> reflection is your own thinking. Some things worth answering: What surprised you? Where did you
> have to push back on the AI? What would you do differently? What do you understand well in this
> codebase, and what would you need to re-read before explaining it in the oral eval?
