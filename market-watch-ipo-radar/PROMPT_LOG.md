# Prompt Log — Market Watch and IPO Radar

## Model Used

Claude, used through Claude Code in VS Code. The session started on **Claude Sonnet 5** and I
switched to **Claude Opus 5** partway through the build.

## Key Prompts

This is not the full conversation. Building this took far more prompts than what follows —
dozens of smaller corrections, clarifications, follow-up questions and back-and-forth debugging.
Listed below are the ones that actually shaped the project: the original spec, the feature
requests, and the moments where I caught something wrong. Two messages are deliberately left
out because they contained live credentials (my Finnhub API key and a GitHub token), which
should never appear in a public repository.

---

I'm building HW3: Explore an API for my 15-113 Effective Coding with AI course at CMU. I've attached the assignment instructions — please read them carefully first.

Project Overview:

I want to build an IPO-focused market dashboard that's unique — something you can't get from the stock app or Yahoo Finance. It should pull real market data and let me explore IPOs in depth.

Core Features:

Macro Market Overview
Real-time prices + daily % change + close price for:
3 major indices (S&P 500, Nasdaq, Dow)
Total US equities index
Total world index
Emerging markets index
Most recent official Fed summary + recent announcements
Refresh button + auto-refresh functionality (no page reload needed)
IPO Focus (Main Feature)
Upcoming IPOs: Full calendar view, filterable by date range
IPO History: Last 5 years of IPO data, filterable by market
Data per IPO: Ticker, company name, IPO date, IPO price, market cap at IPO, % change since IPO, sector
Comparisons: Performance by sector, IPOs that gained >50% in first month, etc.
Technical Requirements
Python backend (recommended, no API key exposure in browser)
Output as an interactive tool/widget (not embedded in portfolio site — users click a link and it opens separately)
Both auto-refresh + manual refresh button
Clean, readable display
API/Data Sources:

Use yfinance for indices (free, no key)
Research IPO data sources (Alpha Vantage has some IPO endpoints, or we can use a free IPO calendar API)
Fed data: FRED API (free) or curated summary from latest announcements

Please help me:

Design the data structure and API calls needed
Build the core Python backend
Create a clean CLI or simple web interface to display the data
Implement refresh functionality
Handle edge cases (missing data, API failures)
This is for a course assignment, so focus on a thoughtful, working implementation over 5-6 hours. Make it something I can add to my portfolio website.

---

Ok, the Macro overview is perfect, keep that excatly as it is. Th eupcoming IPO calendar requires many changes. First, it is currently showing only 3. Second, I should be able to click on them and see the ticker, industry, exchange, etc. Thrid, you can select the date to go all the way to all time, but if I am not mistaken, we only have data from 5 years ago. So don't allow for people to go to 1990 for exmaple if we only have data from 5 years ago. Same for teh future, I dont know how far into the future we have data for, but set a limit for the date we have data for, both for the "from" and "to"

---

Ok, here is what we will do, make a diclamer of where this data comes from and that it not might be 100% accurate or IPOs might be missing and that this is not financial advise, but rather should serev as a guide and then more due diligance should be conuducted from outside soruces. Make a tailor made disclamer for each of the 4 sections. Also, while you are at it, remove anything that says 15-113 watermarks

---

Ok , continuing on disclamer, take the word "broker" people wont be buying after looking at this. Also, on the general disclamer that you have on all 4 tabs, emphasize how this comes from free data, you already mention, but emphasize. Keep all the othe parts of the disclaimer tha samne, I like it

---

Can we call this "Market Watch and IPO Radar". Change everything from IPO Radar to that.

---

2 bug fixes, the "exclude SAPCs and "recalculate" are not doing nothing, make them work please. Also, you mention it comes from "every IPO in the five-year window", I dont think that we ahve the info for every IPO, we already when through this. It is every IPO from the API that we havwe access too, fix that as it currnetly soudns as if we have info for every IPO. Do a check and see that this doesn't happen elsewhere.

---

Ok, we have a couple of problems: 1. When I go all the way back to 2021 for example, the green if above IPO price or red if below IPo price does not happen. Apply this color code to ALL ipo's in the IPO calendar. 2. The "From" and "to" still have bugs. When individuals select a month, allow them to scroll through months and even years, without having to click on a month or year. Then, make sure the scrolling ends at the end data for the "From" as well as the "To". You didn't fix this in the last prompt, do you understand what I am saying? 3. If I select for example, 2021 -2025, not all of them appear, only 4 months appear. Add a "Prev" and "Next" feuature just like the one in IPO history tab that takes individuals to the next and previous months.

---

Prefect, all changes are good. IPO Calendar and IPo History sections ready except of the following: The scrolling of the callendars is way to fast and sensative, make the scroll option less sensative/slower, keep everything else the same, I really like the errors

---

Ok, lets go to the analysis section: In the existing Analysis section, add a new General Metrics subsection with the subtitle "Is investing in IPOs a winning strategy?"

This new General Metrics subsection should appear above the existing "How have recent IPOs performed" section.

Display the following metrics (all updated every time the dashboard refreshes):

Win Rate Metrics:
% of IPOs with net gain since IPO price
% of IPOs with net loss since IPO price
% of IPOs that went up on first day
% of IPOs that went up in first month
Return Metrics:
Average return on day 1 (%)
Average return in month 1 (%)
Worst performer on day 1 (largest single-day loss %)
Best performer on day 1 (largest single-day gain %)
Holding Period Analysis:
Return 1 month later vs. day-1 close (%)
Return 6 months later (%)
Segmented Performance:
Best/worst performing sectors for day-1 IPO returns
Year-over-year trend (how IPO pops are changing by year)
Risk/Reward:
Win/loss ratio
Average gain of winners vs. average loss of losers
Backtested ROI (Optional):
"If you invested $1000 equally in every IPO on day 1 and sold at month-end, total portfolio return by year"
All metrics refresh and update whenever the dashboard is refreshed (manual or auto-refresh). None of this should be hallucinated, rather mathematically computed.

---

TE FALAT VERIFICAR EL 0.00% MEDIAN DAY 1 RETURN

---

Add a 150 sample size, 25, 10, 5, 1

---

Ok, lets modify something, add a section where you addd all the IPOs in the sample even if they didnt make the threshold. This is usefulll to see how the other Ipos perfromed, especially for the sample size of 1.

---

Ok, and then the last part, make sure you understand this is skipable, read well: Add a last section called Individual IPO Data.

First, check if the IPO API we're using provides historical price data for individual IPOs (day-1 close, week-1 close, month-1 close, 3-month, 6-month, YTD, 1-year, all-time). If the API doesn't support this granularity, let me know and we'll skip this section.

If we can get the data, build this section with:

Search bar — users search for a company name or ticker, and it displays:
Ticker
Company name
IPO date
IPO price
Market cap at IPO
% change since IPO
Sector
Price chart — toggle between timeframes:
1 day
1 week
1 month
3 months
6 months
Year to date
1 year
All time
Data source — pull all IPOs from our database (not a calendar view, just a searchable list of all IPOs we have)
Auto-update — new IPOs and price data refresh whenever the dashboard refreshes
Bottom line: Only build this if the API supports historical price data per IPO. If not, skip it.

---

Wow, wow is all I can say. KEEP IT EXCATLY THE SAME, just make it its own section in the dashboard, not under analysis. Title it "Individual IPO Data". Also, if it is not too much to ask, when people go to IPO calendar, IPO history or in teh analysis section, when they click on a stock, can you take them to their rspective page of the "Individual IPO Data"

---

So, before we get to all the submission and uploading my website and my GitHub and all that, I believe this is done. I have gone through it. I don't see any bugs. But maybe I missed something cause so can you please do a check a general check of the code general check of the bugs make sure everything is working fine and then from there we will go on to submit

---

Ok, one last thing is that the general metrics, I don't want a "sample" I wnat it to be a static metric of all the IPOs in the API. Of coruse, it will only change when new dcata shows up, but there shouldn't be a choose a sample size. The point is to give a snapshot of ALL the IPOs in the API

---

Ok , one last thing before we push this to github and my website. Dialogue, no code, the VTI, VT, and VWO indeces are not showing data, they appear as unavailabl;e

---

Ok, we still want everything live, and good idea on making the video on here isnetad of the website. Do what you can that makes it a little fatser wiothout paying money and we still wnat to keep everything live.
