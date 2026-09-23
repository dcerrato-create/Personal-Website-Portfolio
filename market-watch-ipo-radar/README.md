Market Watch and IPO Radar is a Python dashboard that pulls five years of real IPO data and tries to 
answer a question the usual stock apps don't: is investing in IPOs actually a winning strategy? It also 
provides a broad macro market overview, but the distinguisher is the in depth IPO analysis. **The 
API is called** with a plain HTTP `GET` to Finnhub's `/calendar/ipo` endpoint, made from the
Flask backend rather than the browser so the key is never exposed to visitors. **The modules used**
are `requests` for the Finnhub calls, `yfinance` for Yahoo Finance prices, and `feedparser` for the
Federal Reserve's RSS feeds. **The key parameters provided** are `from` and `to` as `YYYY-MM-DD`
dates, plus `token`, which carries the API key. **The format returned** is JSON — an `ipoCalendar`
list whose entries are dictionaries of strings and numbers such as `symbol`, `name`, `date`,
`exchange` and `price` — while `yfinance` returns pandas DataFrames and `feedparser` returns parsed
RSS entries. **The API key is obtained** free at
[finnhub.io/register](https://finnhub.io/register) (no credit card required) and copied from your
dashboard at [finnhub.io/dashboard](https://finnhub.io/dashboard). **The key is used** by copying
`.env.example` to `.env` and setting `FINNHUB_API_KEY=your_key_here`; `.env` is listed in
`.gitignore`, so the key stays local and never enters the repository. **To install**, create a
virtual environment with `python3 -m venv venv`, activate it with `source venv/bin/activate`, and
run `pip install -r requirements.txt`. **To run**, execute `python app.py` and open
**http://127.0.0.1:5000** in your browser, or use the live version at https://market-watch-ipo-radar.onrender.com.
