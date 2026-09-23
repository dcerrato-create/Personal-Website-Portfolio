/* Market Watch and IPO Radar frontend.
   Talks only to this app's own /api/* routes - the Finnhub key never leaves the server. */

const state = {
  tab: 'macro',
  timer: null,
  loading: false,
  history: { page: 1 },
  exchangesLoaded: false,
  upcomingView: 'calendar',
  coverage: null,
  calendarPage: 0,
  individual: null,
};

/* ---------------- helpers ---------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtCompact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${fmtNumber(value, 0)}`;
}

function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${fmtNumber(value, 2)}%`;
}

function dirClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'flat';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

// Arrow + explicit sign means direction never relies on color alone.
function dirGlyph(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  if (value > 0) return '▲ ';
  if (value < 0) return '▼ ';
  return '– ';
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function setStatus(kind, text) {
  $('#status-dot').className = `dot ${kind}`;
  $('#status-text').textContent = text;
}

function stampUpdated() {
  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const auto = $('#auto-refresh').checked ? `auto-refresh on (${$('#interval').value}s)` : 'auto-refresh off';
  setStatus('live', `Updated ${now} · ${auto}`);
}

async function api(path) {
  const res = await fetch(path);
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const error = new Error(body.error || `Request failed (HTTP ${res.status}).`);
    error.type = body.error_type;
    throw error;
  }
  return body;
}

function errorBlock(err) {
  const keyHint = err.type === 'missing_api_key'
    ? '<div class="note">Add your free Finnhub key to <code>.env</code> as <code>FINNHUB_API_KEY</code>, then restart the app.</div>'
    : '';
  return `<div class="banner error"><span class="icon">!</span><div>
      <strong>Couldn't load this data.</strong><div>${escapeHtml(err.message)}</div>${keyHint}
    </div></div>`;
}

function warningBlock(warnings) {
  if (!warnings || !warnings.length) return '';
  return `<div class="banner"><span class="icon">!</span><div>
      <strong>Partial data.</strong> ${warnings.length} date range(s) failed upstream; showing what came back.
      <div class="note">${escapeHtml(warnings[0])}</div>
    </div></div>`;
}

function loadingBlock(message) {
  return `<div class="state">${escapeHtml(message)}</div>`;
}

/* ---------------- macro: indices ---------------- */

async function loadIndices(force) {
  const target = $('#indices-tiles');
  try {
    const data = await api(`/api/indices?refresh=${force ? 'true' : 'false'}`);
    target.innerHTML = data.indices.map((row) => {
      if (row.status === 'error') {
        return `<div class="tile">
            <div class="label">${escapeHtml(row.label)}</div>
            <div class="value">—</div>
            <div class="delta flat">Unavailable</div>
            <div class="meta">${escapeHtml(row.error || 'No data returned')}</div>
          </div>`;
      }
      return `<div class="tile">
          <div class="label">${escapeHtml(row.label)}</div>
          <div class="value">${fmtNumber(row.price)}</div>
          <div class="delta ${dirClass(row.change_pct)}">${dirGlyph(row.change_pct)}${fmtPct(row.change_pct)}</div>
          <div class="meta">Prev close ${fmtNumber(row.previous_close)}</div>
        </div>`;
    }).join('');
  } catch (err) {
    target.innerHTML = errorBlock(err);
  }
}

/* ---------------- macro: fed ---------------- */

async function loadFed(force) {
  const target = $('#fed-content');
  try {
    const data = await api(`/api/fed?refresh=${force ? 'true' : 'false'}`);
    const summary = data.latest_fomc_summary;
    const summaryHtml = summary
      ? `<div class="fed-summary">
           <h3><a href="${escapeHtml(summary.link)}" target="_blank" rel="noopener">${escapeHtml(summary.title)}</a></h3>
           <div class="meta" style="color:var(--text-muted);font-size:12px">${escapeHtml(summary.date)}</div>
           <p>${escapeHtml(summary.summary) || 'No summary text in the feed — open the release for the full statement.'}</p>
         </div>`
      : '<div class="state">No monetary-policy release available right now.</div>';

    const listHtml = data.recent_announcements.length
      ? `<h3 style="font-size:14px;margin:0 0 4px">Recent announcements</h3>
         <ul class="announcements">${data.recent_announcements.map((a) => `
           <li><a href="${escapeHtml(a.link)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>
             <span class="when">${escapeHtml(a.date)}</span></li>`).join('')}</ul>`
      : '';

    const errs = (data.errors || []).length
      ? `<div class="note">Feed warnings: ${escapeHtml(data.errors.join('; '))}</div>` : '';

    target.innerHTML = summaryHtml + listHtml + errs;
  } catch (err) {
    target.innerHTML = errorBlock(err);
  }
}

/* ---------------- upcoming IPOs ---------------- */

/* The calendar renders a window of months at a time and asks the API only for
   that window. That keeps every request small enough to price-check each deal,
   so chips stay colour-coded even when the selected range spans years. */
const MONTHS_PER_PAGE = 4;

function selectedMonthSpan() {
  const start = $('#up-start').value;
  const end = $('#up-end').value;
  if (!start || !end) return null;
  const first = monthIndex(start);
  const last = monthIndex(end);
  return { first, last, total: Math.max(1, last - first + 1) };
}

function monthWindow() {
  const span = selectedMonthSpan();
  if (!span) return null;

  const pages = Math.max(1, Math.ceil(span.total / MONTHS_PER_PAGE));
  const page = Math.min(Math.max(0, state.calendarPage), pages - 1);
  state.calendarPage = page;

  const windowFirst = span.first + page * MONTHS_PER_PAGE;
  const windowLast = Math.min(span.last, windowFirst + MONTHS_PER_PAGE - 1);

  const toIso = (idx, day) => {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(day === 'last' ? lastDay : 1).padStart(2, '0')}`;
  };

  // Never run past the dates the user actually chose.
  let from = toIso(windowFirst, 1);
  let to = toIso(windowLast, 'last');
  if (from < $('#up-start').value) from = $('#up-start').value;
  if (to > $('#up-end').value) to = $('#up-end').value;

  return { from, to, page, pages };
}

function upcomingParams() {
  const win = monthWindow();
  const params = new URLSearchParams();
  if (win) {
    params.set('start', win.from);
    params.set('end', win.to);
  }
  if ($('#up-q').value.trim()) params.set('q', $('#up-q').value.trim());
  return params;
}

/* Wait for a pause in typing before hitting the API on every keystroke. */
function debounce(fn, wait = 350) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* The pickers can only offer dates the data actually covers, so the bounds come
   from the API rather than letting someone ask for 1990. */
async function loadCoverage() {
  try {
    const data = await api('/api/ipo/coverage');
    state.coverage = data;
    applyDateBounds();
    $('#cal-coverage-note').textContent =
      `Upcoming deals plus recently priced ones — click any deal for full details. `
      + `Data covers ${data.earliest} to ${data.latest} `
      + `(${data.priced_count.toLocaleString()} priced, ${data.upcoming_count} upcoming).`;
  } catch (err) {
    state.coverage = null;
  }
}

function clamp(iso, lo, hi) {
  if (!iso) return iso;
  if (lo && iso < lo) return lo;
  if (hi && iso > hi) return hi;
  return iso;
}

function clampToCoverage(iso) {
  if (!state.coverage) return iso;
  return clamp(iso, state.coverage.earliest, state.coverage.latest);
}

/* The history tab can't reach further back than its own lookback window, and
   stops at the last deal that actually priced. */
function historyBounds() {
  const cov = state.coverage;
  if (!cov) return { min: null, max: null };
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - Number($('#hist-years').value));
  const lookbackStart = isoDate(cutoff);
  return {
    min: lookbackStart > cov.earliest ? lookbackStart : cov.earliest,
    max: cov.latest_priced || cov.today,
  };
}

/* Chrome greys out-of-range dates in the popup but still lets you spin or type
   past them, so the bounds are enforced here as well as declared as attributes.
   Each pair is also cross-constrained: "from" can't pass "to", and vice versa. */
function applyDateBounds(changed) {
  if (!state.coverage) return;

  const pairs = [
    { start: $('#up-start'), end: $('#up-end'), min: state.coverage.earliest, max: state.coverage.latest },
    { start: $('#hist-start'), end: $('#hist-end'), ...historyBounds() },
  ];

  pairs.forEach(({ start, end, min, max }) => {
    if (!min || !max) return;

    start.value = clamp(start.value, min, max);
    end.value = clamp(end.value, min, max);

    // A range can't run backwards. Honour whichever field was just edited and
    // move the other one to meet it.
    if (start.value && end.value && start.value > end.value) {
      if (changed === end) start.value = end.value;
      else end.value = start.value;
    }

    start.min = min;
    start.max = end.value || max;
    end.min = start.value || min;
    end.max = max;
  });

  refreshPickerLabels();
}

async function loadUpcoming(force) {
  const target = $('#upcoming-content');
  target.innerHTML = loadingBlock('Loading IPO calendar…');

  // A hand-typed date can still land outside the range; pull it back in.
  $('#up-start').value = clampToCoverage($('#up-start').value);
  $('#up-end').value = clampToCoverage($('#up-end').value);

  const params = upcomingParams();
  if (force) params.set('refresh', 'true');

  try {
    const data = await api(`/api/ipo/calendar?${params}`);
    if (!data.ipos.length) {
      const query = $('#up-q').value.trim();
      target.innerHTML = warningBlock(data.warnings)
        + `<div class="state">${query
          ? `No deals matching &ldquo;${escapeHtml(query)}&rdquo; in this date range — try widening the range or clearing the search.`
          : 'No IPOs in this date range. Try widening it or pick a past range — there are only a handful of confirmed upcoming deals at any time.'}</div>`;
      return;
    }
    const tally = `${data.count} deal(s) in range · ${data.upcoming_count} upcoming · ${data.priced_count} already priced`
      + (data.performance_loaded
        ? ''
        : ` · too many deals to price-check (over ${data.enrich_limit}), so priced deals stay grey — narrow the range to colour them`);

    if (state.upcomingView === 'calendar') {
      const win = monthWindow();
      target.innerHTML = `${warningBlock(data.warnings)}
        ${upcomingCalendar(data.ipos, data.start, data.end)}
        ${calendarPager(win, tally)}`;
      wireDealClicks();
      const prev = $('#cal-prev');
      const next = $('#cal-next');
      if (prev) prev.onclick = () => { state.calendarPage -= 1; loadUpcoming(false); };
      if (next) next.onclick = () => { state.calendarPage += 1; loadUpcoming(false); };
      return;
    }

    const rows = data.ipos.map((r) => `
      <tr class="deal-row" data-symbol="${escapeHtml(r.symbol || '')}"
          data-date="${escapeHtml(r.ipo_date)}" data-name="${escapeHtml(r.name)}" tabindex="0">
        <td>${escapeHtml(r.ipo_date)}</td>
        <td class="ticker">${escapeHtml(r.symbol || '—')}</td>
        <td class="company">${escapeHtml(r.name)}${r.is_spac ? ' <span class="pill">SPAC</span>' : ''}</td>
        <td class="num">${escapeHtml(r.price_raw || '—')}</td>
        <td class="num">${r.shares_offered ? fmtNumber(r.shares_offered, 0) : '—'}</td>
        <td class="num">${fmtCompact(r.offer_size)}</td>
        <td>${escapeHtml(r.exchange)}</td>
        <td><span class="pill ${r.deal_status === 'priced' ? '' : 'pill-upcoming'}">${escapeHtml(r.deal_status)}</span></td>
      </tr>`).join('');

    target.innerHTML = `${warningBlock(data.warnings)}
      <div class="table-scroll"><table>
        <thead><tr>
          <th>Date</th><th>Ticker</th><th>Company</th><th>Price</th>
          <th>Shares offered</th><th>Offer size</th><th>Market</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="pagination">${tally}</div>`;
    wireDealClicks();
  } catch (err) {
    target.innerHTML = errorBlock(err);
  }
}

/* ---------------- custom date picker ----------------
   The native <input type="date"> popup can't be controlled: its month/year
   navigation ignores min/max, so you can scroll to 1990 whatever we set. This
   replaces it with a picker we own, where navigation is bounded by the data. */

const DP_IDS = ['up-start', 'up-end', 'hist-start', 'hist-end'];
const dp = { target: null, year: 0, month: 0 };

// Wheel sensitivity: accumulated scroll distance per month, the floor on time
// between months, and the pause that counts as the start of a new gesture.
const WHEEL_STEP_DELTA = 120;
const WHEEL_MIN_INTERVAL_MS = 180;
const WHEEL_GESTURE_RESET_MS = 300;

function monthIndex(iso) {
  return Number(iso.slice(0, 4)) * 12 + (Number(iso.slice(5, 7)) - 1);
}

function fmtTrigger(iso) {
  if (!iso) return 'Any date';
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`;
}

function refreshPickerLabels() {
  DP_IDS.forEach((id) => {
    const btn = $(`#${id}-btn`);
    if (btn) btn.textContent = fmtTrigger($(`#${id}`).value);
  });
}

function openPicker(id) {
  const input = $(`#${id}`);
  dp.target = input;

  const anchor = iso(input.value) || input.min || isoDate(new Date());
  dp.year = Number(anchor.slice(0, 4));
  dp.month = Number(anchor.slice(5, 7)) - 1;

  const pop = $('#dp-pop');
  pop.hidden = false;

  const rect = $(`#${id}-btn`).getBoundingClientRect();
  pop.style.top = `${rect.bottom + window.scrollY + 6}px`;
  pop.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 300)}px`;

  renderPicker();
}

function iso(value) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function closePicker() {
  $('#dp-pop').hidden = true;
  dp.target = null;
}

/* Navigation is clamped to the month containing min and the month containing max,
   so scrolling simply stops at the edge of the data instead of running forever. */
function stepPicker(months) {
  if (!dp.target) return;
  const min = dp.target.min;
  const max = dp.target.max;

  let target = dp.year * 12 + dp.month + months;
  if (min) target = Math.max(target, monthIndex(min));
  if (max) target = Math.min(target, monthIndex(max));

  dp.year = Math.floor(target / 12);
  dp.month = target % 12;
  renderPicker();
}

function renderPicker() {
  if (!dp.target) return;
  const min = dp.target.min;
  const max = dp.target.max;
  const selected = iso(dp.target.value);
  const current = dp.year * 12 + dp.month;

  $('#dp-label').textContent = `${MONTH_NAMES[dp.month]} ${dp.year}`;
  $('#dp-dow').innerHTML = DOW.map((d) => `<span class="dp-dow-cell">${d[0]}</span>`).join('');

  // Grey out a nav arrow once there's nothing beyond it.
  $$('#dp-pop .dp-nav').forEach((btn) => {
    const next = current + Number(btn.dataset.step);
    const blocked = (min && next < monthIndex(min) && current <= monthIndex(min))
      || (max && next > monthIndex(max) && current >= monthIndex(max));
    btn.disabled = Boolean(blocked);
  });

  const daysInMonth = new Date(Date.UTC(dp.year, dp.month + 1, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(dp.year, dp.month, 1)).getUTCDay();

  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push('<span class="dp-cell empty"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = `${dp.year}-${String(dp.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const disabled = (min && value < min) || (max && value > max);
    cells.push(`<button type="button" class="dp-cell${value === selected ? ' selected' : ''}"
        ${disabled ? 'disabled' : ''} data-value="${value}">${day}</button>`);
  }
  $('#dp-grid').innerHTML = cells.join('');

  $('#dp-foot').textContent = min && max
    ? `Selectable: ${fmtTrigger(min)} – ${fmtTrigger(max)}`
    : '';

  $$('#dp-grid .dp-cell[data-value]').forEach((cell) => {
    cell.onclick = () => {
      const input = dp.target;
      input.value = cell.dataset.value;
      closePicker();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
  });
}

function initPickers() {
  DP_IDS.forEach((id) => {
    const btn = $(`#${id}-btn`);
    if (btn) btn.onclick = (event) => { event.stopPropagation(); openPicker(id); };
  });

  $$('#dp-pop .dp-nav').forEach((btn) => {
    btn.onclick = () => stepPicker(Number(btn.dataset.step));
  });

  // Wheel over the popup walks through months, and stops dead at the bounds.
  // A trackpad fires dozens of small wheel events per flick, so rather than
  // stepping on each one, deltas accumulate to a threshold and steps are rate
  // limited - one notch of a mouse wheel is about one month.
  let wheelAccum = 0;
  let lastWheelAt = 0;
  let lastStepAt = 0;

  $('#dp-pop').addEventListener('wheel', (event) => {
    event.preventDefault();
    const now = Date.now();

    if (now - lastWheelAt > WHEEL_GESTURE_RESET_MS) wheelAccum = 0;
    lastWheelAt = now;

    wheelAccum += event.deltaY;
    if (Math.abs(wheelAccum) < WHEEL_STEP_DELTA) return;
    if (now - lastStepAt < WHEEL_MIN_INTERVAL_MS) return;

    stepPicker(wheelAccum > 0 ? 1 : -1);
    wheelAccum = 0;
    lastStepAt = now;
  }, { passive: false });

  document.addEventListener('click', (event) => {
    if (!$('#dp-pop').hidden && !event.target.closest('#dp-pop')) closePicker();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#dp-pop').hidden) closePicker();
  });
}

/* ---------------- jump to a ticker ----------------
   Clicking a deal anywhere in the dashboard opens it in the Individual IPO Data
   tab, which carries the same facts plus the price chart. */

function wireDealClicks() {
  $$('.deal-row, .cal-chip').forEach((el) => {
    el.onclick = () => openIndividual(el.dataset.symbol, el.dataset.date, el.dataset.name);
    el.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openIndividual(el.dataset.symbol, el.dataset.date, el.dataset.name);
      }
    };
  });
}

async function openIndividual(symbol, ipoDate, name) {
  switchTab('individual');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (!symbol) {
    $('#ind-q').value = name || '';
    $('#ind-results').innerHTML = '';
    $('#ind-detail').innerHTML = `<div class="state">${escapeHtml(name || 'This deal')} has no ticker
      assigned yet, so there is no price history to chart. It will appear here once it lists.</div>`;
    return;
  }

  $('#ind-q').value = symbol;
  searchIndividual();
  await selectIndividual(symbol, ipoDate);
}

function calendarPager(win, tally) {
  if (!win) return `<div class="pagination">${tally}</div>`;
  if (win.pages <= 1) return `<div class="pagination">${tally}</div>`;

  const label = (isoStr) => {
    const [y, m] = isoStr.split('-');
    return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`;
  };

  return `<div class="pagination">
      <button id="cal-prev" ${win.page <= 0 ? 'disabled' : ''}>← Prev</button>
      <span>${label(win.from)} – ${label(win.to)} · window ${win.page + 1} of ${win.pages}</span>
      <button id="cal-next" ${win.page >= win.pages - 1 ? 'disabled' : ''}>Next →</button>
    </div>
    <div class="pagination">${tally}</div>`;
}

/* Month-grid calendar for upcoming IPOs. Built from plain Y/M integers and ISO
   date strings so nothing shifts by a day across timezones. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CALENDAR_MONTHS = 4;

/* Upcoming deals are blue; priced deals go green or red by whether they're trading
   above or below their offer price, and stay grey when there's no usable price. */
function chipClass(r) {
  if (r.deal_status !== 'priced') return 'chip-upcoming';
  const pct = r.pct_change_since_ipo;
  if (pct === null || pct === undefined) return 'chip-priced';
  return pct >= 0 ? 'chip-up' : 'chip-down';
}

/* Arrow so above/below never rides on green-vs-red alone. */
function chipGlyph(r) {
  if (r.deal_status !== 'priced') return '';
  const pct = r.pct_change_since_ipo;
  if (pct === null || pct === undefined) return '';
  return pct >= 0 ? '▲ ' : '▼ ';
}

function chipTitle(r) {
  const base = `${r.name} · ${r.price_raw || 'price TBD'} · ${r.exchange}`;
  if (r.deal_status !== 'priced') return `${base} — upcoming, click to open its page`;
  const pct = r.pct_change_since_ipo;
  if (pct === null || pct === undefined) return `${base} — no price data, click to open its page`;
  const dir = pct >= 0 ? 'above' : 'below';
  return `${base} — ${fmtPct(pct)} since IPO (${dir} offer price), click to open its page`;
}

function upcomingCalendar(ipos, startIso, endIso) {
  const byDate = {};
  ipos.forEach((r) => {
    if (!r.ipo_date) return;
    (byDate[r.ipo_date] = byDate[r.ipo_date] || []).push(r);
  });

  const start = startIso || (ipos[0] && ipos[0].ipo_date) || isoDate(new Date());
  const end = endIso || ipos.reduce((acc, r) => (r.ipo_date > acc ? r.ipo_date : acc), start);

  let [year, month] = [Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1];
  const [endYear, endMonth] = [Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1];

  const months = [];
  while ((year < endYear || (year === endYear && month <= endMonth))
         && months.length < MAX_CALENDAR_MONTHS) {
    months.push([year, month]);
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }

  const today = isoDate(new Date());

  return months.map(([y, m]) => {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();

    const cells = [];
    for (let i = 0; i < firstDow; i += 1) cells.push('<div class="cal-day empty"></div>');

    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const deals = byDate[iso] || [];
      const outOfRange = iso < start || iso > end;
      const chips = deals.map((r) => `
        <span class="cal-chip ${chipClass(r)}"
              tabindex="0" role="button"
              data-symbol="${escapeHtml(r.symbol || '')}" data-date="${escapeHtml(r.ipo_date)}"
              data-name="${escapeHtml(r.name)}"
              title="${escapeHtml(chipTitle(r))}">
          ${chipGlyph(r)}${escapeHtml(r.symbol || r.name.slice(0, 10))}
        </span>`).join('');
      cells.push(`<div class="cal-day${outOfRange ? ' muted' : ''}${iso === today ? ' today' : ''}">
          <span class="cal-date">${day}</span>${chips}
        </div>`);
    }

    return `<div class="cal-month">
        <h4>${MONTH_NAMES[m]} ${y}</h4>
        <div class="cal-grid">
          ${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('')}
          ${cells.join('')}
        </div>
      </div>`;
  }).join('');
}

/* ---------------- IPO history ---------------- */

function historyParams() {
  const params = new URLSearchParams({
    years: $('#hist-years').value,
    page: String(state.history.page),
    page_size: $('#hist-page-size').value,
    exchange: $('#hist-exchange').value,
  });
  const start = $('#hist-start').value;
  const end = $('#hist-end').value;
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  if ($('#hist-no-spacs').checked) params.set('exclude_spacs', 'true');
  if ($('#hist-q').value.trim()) params.set('q', $('#hist-q').value.trim());
  return params;
}

async function loadHistory(force) {
  const target = $('#history-content');
  target.innerHTML = loadingBlock('Loading IPO history (first load pulls 5 years from Finnhub)…');
  const params = historyParams();
  if (force) params.set('refresh', 'true');

  try {
    const data = await api(`/api/ipo/history?${params}`);

    if (!state.exchangesLoaded && data.exchanges.length) {
      const select = $('#hist-exchange');
      const current = select.value;
      select.innerHTML = '<option value="All">All markets</option>'
        + data.exchanges.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
      select.value = current;
      state.exchangesLoaded = true;
    }

    if (!data.ipos.length) {
      const query = $('#hist-q').value.trim();
      target.innerHTML = warningBlock(data.warnings)
        + `<div class="state">${query
          ? `No IPOs matching &ldquo;${escapeHtml(query)}&rdquo;. Note this only searches deals inside the selected lookback and market filters.`
          : 'No IPOs matched these filters.'}</div>`;
      return;
    }

    const rows = data.ipos.map((r) => `
      <tr class="deal-row" data-symbol="${escapeHtml(r.symbol || '')}"
          data-date="${escapeHtml(r.ipo_date)}" data-name="${escapeHtml(r.name)}" tabindex="0">
        <td class="ticker">${escapeHtml(r.symbol || '—')}</td>
        <td class="company">${escapeHtml(r.name)}${r.is_spac ? ' <span class="pill">SPAC</span>' : ''}</td>
        <td>${escapeHtml(r.ipo_date)}</td>
        <td class="num">${r.ipo_price ? `$${fmtNumber(r.ipo_price)}` : '—'}</td>
        <td class="num">${fmtCompact(r.est_market_cap_at_ipo)}</td>
        <td class="num">${r.current_price ? `$${fmtNumber(r.current_price)}` : '—'}</td>
        <td class="num ${dirClass(r.pct_change_since_ipo)}">${dirGlyph(r.pct_change_since_ipo)}${fmtPct(r.pct_change_since_ipo)}</td>
        <td class="num ${dirClass(r.pct_change_first_month)}">${dirGlyph(r.pct_change_first_month)}${fmtPct(r.pct_change_first_month)}</td>
        <td>${escapeHtml(r.sector || 'Unknown')}</td>
        <td>${escapeHtml(r.exchange)}</td>
      </tr>`).join('');

    target.innerHTML = `${warningBlock(data.warnings)}
      <div class="table-scroll"><table>
        <thead><tr>
          <th>Ticker</th><th>Company</th><th>IPO date</th><th>IPO price</th>
          <th>Est. mkt cap at IPO</th><th>Current</th><th>% since IPO</th>
          <th>1st month %</th><th>Sector</th><th>Market</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="pagination">
        <button id="prev-page" ${data.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <span>Page ${data.page} of ${data.total_pages} · ${data.total} priced IPOs</span>
        <button id="next-page" ${data.page >= data.total_pages ? 'disabled' : ''}>Next →</button>
      </div>
      <div class="note">Est. market cap at IPO = offer price × current shares outstanding. Free data sources
        don't publish at-IPO share counts, so treat it as an estimate.</div>`;

    wireDealClicks();
    const prev = $('#prev-page');
    const next = $('#next-page');
    if (prev) prev.onclick = () => { state.history.page -= 1; loadHistory(false); };
    if (next) next.onclick = () => { state.history.page += 1; loadHistory(false); };
  } catch (err) {
    target.innerHTML = errorBlock(err);
  }
}

/* ---------------- individual IPO explorer ---------------- */

const CHART_RANGE_ORDER = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', 'max'];
const CHART_RANGE_LABELS = {
  '1d': '1D', '1w': '1W', '1m': '1M', '3m': '3M',
  '6m': '6M', ytd: 'YTD', '1y': '1Y', max: 'All',
};

async function searchIndividual() {
  const query = $('#ind-q').value.trim();
  const target = $('#ind-results');
  if (!query) {
    target.innerHTML = '';
    return;
  }
  try {
    const data = await api(`/api/ipo/search?q=${encodeURIComponent(query)}`);
    if (!data.count) {
      target.innerHTML = `<div class="state">No IPO matching &ldquo;${escapeHtml(query)}&rdquo; in our ${data.searched} deals.</div>`;
      return;
    }
    target.innerHTML = `<ul class="search-results">${data.results.map((r) => `
        <li><button type="button" class="search-hit" data-symbol="${escapeHtml(r.symbol || '')}"
                data-date="${escapeHtml(r.ipo_date || '')}">
          <span class="hit-ticker">${escapeHtml(r.symbol || '—')}</span>
          <span class="hit-name">${escapeHtml(r.name)}${r.is_spac ? ' <span class="pill">SPAC</span>' : ''}</span>
          <span class="hit-meta">${escapeHtml(r.ipo_date)} · ${escapeHtml(r.exchange)}</span>
        </button></li>`).join('')}</ul>`;

    $$('.search-hit').forEach((btn) => {
      btn.onclick = () => selectIndividual(btn.dataset.symbol, btn.dataset.date);
    });
  } catch (err) {
    target.innerHTML = errorBlock(err);
  }
}

async function selectIndividual(symbol, ipoDate) {
  if (!symbol) {
    $('#ind-detail').innerHTML = '<div class="state">This deal has no ticker assigned yet, so there is no price history to chart.</div>';
    return;
  }
  state.individual = { symbol, ipoDate, range: state.individual?.range || 'max' };
  await loadIndividual();
}

async function loadIndividual(force) {
  const sel = state.individual;
  if (!sel || !sel.symbol) return;
  const target = $('#ind-detail');
  target.innerHTML = loadingBlock(`Loading ${sel.symbol}…`);

  try {
    const params = new URLSearchParams({ symbol: sel.symbol });
    if (sel.ipoDate) params.set('date', sel.ipoDate);

    const chartParams = new URLSearchParams(params);
    chartParams.set('range', sel.range);
    if (force) chartParams.set('refresh', 'true');

    const [detail, chart] = await Promise.all([
      api(`/api/ipo/detail?${params}`),
      api(`/api/ipo/chart?${chartParams}`),
    ]);

    target.innerHTML = renderIndividual(detail.ipo, chart);
    $$('#ind-ranges button').forEach((btn) => {
      btn.onclick = () => {
        state.individual.range = btn.dataset.range;
        loadIndividual(false);
      };
    });
    wireLineChart(chart);
  } catch (err) {
    target.innerHTML = errorBlock(err);
  }
}

function renderIndividual(r, chart) {
  const facts = `<div class="tiles tiles-auto" style="margin:16px 0 20px">
      ${metricTile('Ticker', escapeHtml(r.symbol || '—'), r.exchange || '')}
      ${metricTile('IPO date', escapeHtml(r.ipo_date || '—'), r.deal_status === 'priced' ? 'Priced' : 'Upcoming')}
      ${metricTile('IPO price', r.ipo_price ? `$${fmtNumber(r.ipo_price)}` : '—', 'Offer price')}
      ${metricTile('Est. market cap at IPO', fmtCompact(r.est_market_cap_at_ipo), 'Offer price × shares')}
      ${signedTile('% since IPO', r.pct_change_since_ipo, r.current_price ? `Now $${fmtNumber(r.current_price)}` : 'No current price')}
      ${metricTile('Sector', escapeHtml(r.sector || 'Unknown'), r.industry || '')}
    </div>`;

  const ranges = `<div class="presets" id="ind-ranges">
      ${CHART_RANGE_ORDER.map((key) => `<button data-range="${key}"
          ${key === state.individual.range ? 'aria-pressed="true"' : ''}>${CHART_RANGE_LABELS[key]}</button>`).join('')}
    </div>`;

  const header = `<div class="chart-header">
      <div>
        <h3 style="margin:0;font-size:16px">${escapeHtml(r.name)}</h3>
        <div class="note" style="margin:2px 0 0">${escapeHtml(chart.label || '')}${chart.change_pct === null || chart.change_pct === undefined ? ''
    : ` · <span class="${dirClass(chart.change_pct)}">${dirGlyph(chart.change_pct)}${fmtPct(chart.change_pct)}</span> over this window`}</div>
      </div>
      ${ranges}
    </div>`;

  const body = chart.status === 'ok' && chart.points.length > 1
    ? `<div class="chart-wrap">${lineChart(chart, r.ipo_price)}</div>
       <div class="note">High $${fmtNumber(chart.high)} · Low $${fmtNumber(chart.low)} ·
         ${chart.points.length} points at ${escapeHtml(chart.interval)} intervals.
         ${chart.split_factor && Math.abs(chart.split_factor - 1) > 0.0001
    ? 'Prices are adjusted back to what actually traded, so they differ from a split-adjusted chart elsewhere.' : ''}</div>`
    : `<div class="state">${chart.status === 'no_data'
      ? 'Yahoo Finance has no price data for this ticker over this window. It may be too new, or since delisted or renamed.'
      : escapeHtml(chart.status || 'No chart data.')}</div>`;

  return facts + header + body;
}

/* Single-series price line: 2px stroke, a 10% wash beneath it, and a crosshair
   on hover. Coloured by the window's direction, with the signed % in the header
   so colour is never the only cue. */
function lineChart(chart, ipoPrice) {
  const W = 900;
  const H = 300;
  const padL = 56;
  const padR = 16;
  const padT = 14;
  const padB = 28;
  const points = chart.points;

  const closes = points.map((p) => p.c);
  let lo = Math.min(...closes);
  let hi = Math.max(...closes);
  const showIpoLine = ipoPrice && ipoPrice >= lo * 0.5 && ipoPrice <= hi * 1.5;
  if (showIpoLine) {
    lo = Math.min(lo, ipoPrice);
    hi = Math.max(hi, ipoPrice);
  }
  const span = (hi - lo) || (hi || 1) * 0.1;
  lo -= span * 0.08;
  hi += span * 0.08;

  const x = (i) => padL + (i / Math.max(1, points.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const up = (chart.change_pct || 0) >= 0;
  const stroke = up ? 'var(--good)' : 'var(--critical)';

  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.c).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${y(lo).toFixed(1)} L ${x(0).toFixed(1)} ${y(lo).toFixed(1)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const value = lo + f * (hi - lo);
    const yy = y(value);
    return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"
              stroke="var(--gridline)" stroke-width="1"></line>
            <text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11"
              font-variant-numeric="tabular-nums" fill="var(--text-muted)">$${fmtNumber(value, value < 10 ? 2 : 0)}</text>`;
  }).join('');

  const intraday = chart.interval.includes('m') || chart.interval.includes('h');
  const fmtT = (iso) => (intraday ? iso.slice(11, 16) : iso.slice(0, 10));
  const xLabels = [0, Math.floor(points.length / 2), points.length - 1].map((i) => `
      <text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}"
        font-size="11" fill="var(--text-muted)">${escapeHtml(fmtT(points[i].t))}</text>`).join('');

  const ipoLine = showIpoLine
    ? `<line x1="${padL}" y1="${y(ipoPrice).toFixed(1)}" x2="${W - padR}" y2="${y(ipoPrice).toFixed(1)}"
         stroke="var(--text-muted)" stroke-width="1"></line>
       <text x="${W - padR}" y="${(y(ipoPrice) - 5).toFixed(1)}" text-anchor="end" font-size="10.5"
         fill="var(--text-muted)">IPO $${fmtNumber(ipoPrice)}</text>`
    : '';

  return `<svg id="ind-chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
            aria-label="Price chart">
      ${ticks}
      ${ipoLine}
      <path d="${area}" fill="${stroke}" opacity="0.1"></path>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"></path>
      <line id="ind-cross" x1="0" y1="${padT}" x2="0" y2="${H - padB}"
            stroke="var(--baseline)" stroke-width="1" opacity="0"></line>
      <circle id="ind-dot" r="4.5" fill="${stroke}" stroke="var(--surface)" stroke-width="2" opacity="0"></circle>
      ${xLabels}
      <rect id="ind-hit" x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}"
            fill="transparent"></rect>
    </svg>`;
}

function wireLineChart(chart) {
  const svg = $('#ind-chart');
  const hit = $('#ind-hit');
  if (!svg || !hit || !chart.points || chart.points.length < 2) return;

  const tip = $('#tooltip');
  const cross = $('#ind-cross');
  const dot = $('#ind-dot');
  const W = 900;
  const padL = 56;
  const padR = 16;
  const points = chart.points;
  const intraday = chart.interval.includes('m') || chart.interval.includes('h');

  hit.addEventListener('mousemove', (event) => {
    const box = svg.getBoundingClientRect();
    const svgX = ((event.clientX - box.left) / box.width) * W;
    const ratio = (svgX - padL) / (W - padL - padR);
    const index = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    const point = points[index];

    const px = padL + (index / (points.length - 1)) * (W - padL - padR);
    cross.setAttribute('x1', px);
    cross.setAttribute('x2', px);
    cross.setAttribute('opacity', '1');

    const paths = svg.querySelectorAll('path');
    const linePath = paths[paths.length - 1];
    const total = linePath.getTotalLength();
    // Walk the rendered path to find the y for this x - avoids re-deriving the scale.
    let best = null;
    for (let i = 0; i <= 100; i += 1) {
      const p = linePath.getPointAtLength((i / 100) * total);
      if (!best || Math.abs(p.x - px) < Math.abs(best.x - px)) best = p;
    }
    if (best) {
      dot.setAttribute('cx', best.x);
      dot.setAttribute('cy', best.y);
      dot.setAttribute('opacity', '1');
    }

    tip.innerHTML = `<div class="tt-title">$${fmtNumber(point.c)}</div>
      <div class="tt-row">${escapeHtml(intraday ? point.t.slice(0, 16).replace('T', ' ') : point.t.slice(0, 10))}</div>`;
    tip.classList.add('show');
    tip.style.left = `${event.pageX + 14}px`;
    tip.style.top = `${event.pageY - 10}px`;
  });

  hit.addEventListener('mouseleave', () => {
    tip.classList.remove('show');
    cross.setAttribute('opacity', '0');
    dot.setAttribute('opacity', '0');
  });
}

/* ---------------- analysis: general metrics ---------------- */

/* `announce` is for user-triggered runs: recomputing the whole population takes
   a minute or more, and without a progress state the page just looks frozen.
   Background auto-refreshes stay silent because they almost always hit cache. */
async function loadGeneral(force, announce) {
  const target = $('#general-content');
  const button = $('#gen-apply');
  const firstLoad = !target.querySelector('.tiles');

  if (firstLoad || announce) {
    const scope = $('#gen-no-spacs').checked
      ? 'every non-SPAC IPO the API has for this window'
      : 'every IPO the API has for this window, SPACs included';
    target.innerHTML = loadingBlock(`Recomputing across ${scope} — this pulls several hundred companies from Yahoo Finance and can take a minute or two. The finished snapshot is then cached.`);
  }

  const params = new URLSearchParams({
    years: $('#hist-years').value,
    exclude_spacs: $('#gen-no-spacs').checked ? 'true' : 'false',
  });
  if (force) params.set('refresh', 'true');

  button.disabled = true;
  try {
    const data = await api(`/api/ipo/general?${params}`);
    target.innerHTML = renderGeneral(data);
    wireChartTooltips();
  } catch (err) {
    target.innerHTML = errorBlock(err);
  } finally {
    button.disabled = false;
  }
}

function metricTile(label, value, meta, className = '') {
  return `<div class="tile">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value ${className}">${value}</div>
      <div class="meta">${escapeHtml(meta)}</div>
    </div>`;
}

function pctTile(label, value, meta) {
  const shown = value === null || value === undefined ? '—' : `${fmtNumber(value, value >= 100 ? 0 : 1)}%`;
  return metricTile(label, shown, meta);
}

function signedTile(label, value, meta) {
  const shown = value === null || value === undefined ? '—' : `${dirGlyph(value)}${fmtPct(value)}`;
  return metricTile(label, shown, meta, dirClass(value));
}

function renderGeneral(d) {
  const c = d.counts;
  const w = d.win_rates;
  const r = d.returns;
  const h = d.holding_period;
  const rr = d.risk_reward;

  const extremeTile = (label, item) => {
    if (!item) return metricTile(label, '—', 'No data in sample');
    return metricTile(
      label,
      `${dirGlyph(item.value)}${fmtPct(item.value)}`,
      `${item.symbol} · ${item.ipo_date} · ${item.sector}`,
      dirClass(item.value),
    );
  };

  const winRates = `<h4 class="metric-head">Win rate</h4>
    <div class="tiles tiles-auto">
      ${pctTile('Net gain since IPO price', w.pct_net_gain_since_ipo, `${c.with_current_price} IPOs with current prices`)}
      ${pctTile('Net loss since IPO price', w.pct_net_loss_since_ipo, `${c.with_current_price} IPOs with current prices`)}
      ${pctTile('Rose on day 1', w.pct_up_day1, `${c.with_day1} IPOs with a first-day close`)}
      ${pctTile('Rose over first month', w.pct_up_month1, `${c.with_month1} IPOs that reached 21 trading days`)}
    </div>`;

  const returns = `<h4 class="metric-head">Returns</h4>
    <div class="tiles tiles-auto">
      ${signedTile('Average day-1 return', r.avg_day1_pct, 'Offer price to first close')}
      ${signedTile('Median day-1 return', r.median_day1_pct, 'Less skewed by outliers than the mean')}
      ${signedTile('Average month-1 return', r.avg_month1_pct, 'Offer price to 21 trading days')}
      ${extremeTile('Best day 1', r.best_day1)}
      ${extremeTile('Worst day 1', r.worst_day1)}
    </div>`;

  const holding = `<h4 class="metric-head">Holding period</h4>
    <div class="tiles tiles-auto">
      ${signedTile('Month 1, bought at day-1 close', h.avg_month1_from_day1_close_pct, 'The return actually available to open-market buyers')}
      ${signedTile('Six months from offer price', h.avg_six_month_pct, `${c.with_six_month} IPOs old enough to measure`)}
      ${pctTile('Rose after the day-1 close', h.pct_up_from_day1_close, 'Share that gained over month one')}
    </div>`;

  const risk = `<h4 class="metric-head">Risk and reward</h4>
    <div class="tiles tiles-auto">
      ${metricTile('Win / loss ratio', rr.win_loss_ratio === null ? '—' : fmtNumber(rr.win_loss_ratio, 2), `${rr.winners} winners vs ${rr.losers} losers`)}
      ${signedTile('Average gain of winners', rr.avg_gain_of_winners_pct, `Across ${rr.winners} IPOs now above offer`)}
      ${signedTile('Average loss of losers', rr.avg_loss_of_losers_pct, `Across ${rr.losers} IPOs now below offer`)}
      ${metricTile('Payoff ratio', rr.payoff_ratio === null ? '—' : fmtNumber(rr.payoff_ratio, 2), 'Average win ÷ average loss')}
    </div>`;

  const yoy = d.year_over_year.length
    ? `<h4 class="metric-head">Year-over-year: average day-1 pop</h4>
       <div class="chart-wrap">${divergingBars(
    d.year_over_year.map((g) => ({ label: g.key, value: g.mean, count: g.count })),
    'Average day-1 return', 'IPOs',
  )}</div>`
    : '';

  const sectors = d.sector_day1.length
    ? `<h4 class="metric-head">Day-1 return by sector</h4>
       <p class="sub">Sectors with at least three IPOs in the sample. Small counts move a lot — check the tooltip.</p>
       <div class="chart-wrap">${divergingBars(
    d.sector_day1.map((g) => ({ label: g.key, value: g.mean, count: g.count })),
    'Average day-1 return', 'IPOs',
  )}</div>`
    : '';

  const backtest = d.backtest.length
    ? `<h4 class="metric-head">Backtest: $1,000 spread equally across every IPO in the dataset</h4>
       <p class="sub">Buying each IPO at its day-1 close and selling 21 trading days later. Equal weighting
         means the portfolio return is the average of the individual returns.</p>
       <div class="table-scroll"><table>
         <thead><tr><th>Year</th><th>IPOs</th><th>Average return</th><th>Invested</th><th>Final value</th><th>Profit / loss</th></tr></thead>
         <tbody>${d.backtest.map((g) => `
           <tr>
             <td>${escapeHtml(g.year)}</td>
             <td class="num">${g.ipos}</td>
             <td class="num ${dirClass(g.mean_return_pct)}">${dirGlyph(g.mean_return_pct)}${fmtPct(g.mean_return_pct)}</td>
             <td class="num">$${fmtNumber(g.invested, 0)}</td>
             <td class="num">$${fmtNumber(g.final_value)}</td>
             <td class="num ${dirClass(g.profit)}">${g.profit >= 0 ? '+' : '−'}$${fmtNumber(Math.abs(g.profit))}</td>
           </tr>`).join('')}</tbody>
       </table></div>`
    : '';

  const basis = `<div class="note">Computed across all ${d.population.toLocaleString()} IPOs
    <em>in our dataset</em> for the ${d.years}-year window${d.excluded_spacs ? ` (${d.spacs_excluded.toLocaleString()} SPACs excluded from ${d.total_priced.toLocaleString()} priced deals)` : ' (SPACs included)'} &mdash;
    the whole set rather than a sample of it, though the Finnhub free tier does not list every IPO that
    happened. Snapshot taken ${escapeHtml(d.computed_at || '')} and cached, since it only moves as new
    deals list and prices shift &mdash; hit Recalculate to force a fresh one.</div>`;

  return warningBlock(d.warnings) + winRates + returns + holding + risk + yoy + sectors + backtest + basis;
}

/* Horizontal diverging bars around a zero baseline, shared by the year-over-year
   and sector breakdowns. */
function divergingBars(items, valueLabel, countLabel) {
  const W = 820;
  const rowH = 30;
  const barH = 18;
  const gutter = 168;
  const top = 12;
  const H = top + items.length * rowH + 22;

  // Place the zero line by where the data actually sits, so an all-positive set
  // uses the full width instead of stranding half the chart empty.
  const values = items.map((i) => i.value);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const range = (maxV - minV) || 1;
  const labelSpace = 64;
  const plotW = W - gutter - 20;
  const leftPad = minV < 0 ? labelSpace : 0;
  const rightPad = maxV > 0 ? labelSpace : 0;
  const usable = plotW - leftPad - rightPad;
  const zeroX = gutter + leftPad + (-minV / range) * usable;
  const scale = (v) => (v / range) * usable;

  const bars = items.map((item, i) => {
    const y = top + i * rowH + (rowH - barH) / 2;
    const len = scale(item.value);
    const r = 4;
    const x1 = zeroX + len;
    let d;
    if (Math.abs(len) < r) {
      d = `M ${zeroX} ${y} h ${len} v ${barH} h ${-len} Z`;
    } else if (len > 0) {
      d = `M ${zeroX} ${y} H ${x1 - r} Q ${x1} ${y} ${x1} ${y + r} V ${y + barH - r} Q ${x1} ${y + barH} ${x1 - r} ${y + barH} H ${zeroX} Z`;
    } else {
      d = `M ${zeroX} ${y} H ${x1 + r} Q ${x1} ${y} ${x1} ${y + r} V ${y + barH - r} Q ${x1} ${y + barH} ${x1 + r} ${y + barH} H ${zeroX} Z`;
    }
    const label = item.label.length > 22 ? `${item.label.slice(0, 21)}…` : item.label;
    return `<g class="bar-row" data-sector="${escapeHtml(item.label)}" data-count="${item.count}"
              data-avg="${fmtPct(item.value)}" data-median="—" data-best="—" data-worst="—"
              data-valuelabel="${escapeHtml(valueLabel)}" data-countlabel="${escapeHtml(countLabel)}">
        <rect x="0" y="${top + i * rowH}" width="${W}" height="${rowH}" fill="transparent"></rect>
        <text x="${gutter - 12}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="12.5"
              fill="var(--text-secondary)">${escapeHtml(label)}</text>
        <path d="${d}" fill="${item.value >= 0 ? 'var(--good)' : 'var(--critical)'}"></path>
        <text x="${zeroX + len + (item.value >= 0 ? 7 : -7)}" y="${y + barH / 2 + 4}"
              text-anchor="${item.value >= 0 ? 'start' : 'end'}" font-size="12"
              font-variant-numeric="tabular-nums" fill="var(--text-secondary)">${fmtPct(item.value)}</text>
      </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
            aria-label="${escapeHtml(valueLabel)}">
      <line x1="${zeroX}" y1="${top - 4}" x2="${zeroX}" y2="${top + items.length * rowH + 2}"
            stroke="var(--baseline)" stroke-width="1"></line>
      ${bars}
      <text x="${zeroX}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--text-muted)">0%</text>
    </svg>`;
}

/* ---------------- analysis ---------------- */

async function loadStats() {
  const target = $('#stats-content');
  target.innerHTML = loadingBlock('Pulling each IPO from Yahoo Finance… this can take 30–60s the first time.');

  const params = new URLSearchParams({
    years: $('#hist-years').value,
    sample: $('#stats-sample').value,
    threshold: $('#stats-threshold').value,
    exclude_spacs: $('#stats-no-spacs').checked ? 'true' : 'false',
  });

  try {
    const data = await api(`/api/ipo/stats?${params}`);
    target.innerHTML = renderStats(data);
    wireChartTooltips();
    wireDealClicks();
  } catch (err) {
    target.innerHTML = errorBlock(err);
  }
}

function renderStats(data) {
  const tiles = `<div class="tiles" style="margin-bottom:22px">
      <div class="tile">
        <div class="label">Trading above their IPO price</div>
        <div class="value">${data.pct_trading_above_ipo_price === null ? '—' : `${fmtNumber(data.pct_trading_above_ipo_price, 1)}%`}</div>
        <div class="meta">of ${data.scored_size} IPOs with usable price data</div>
      </div>
      <div class="tile">
        <div class="label">Popped over ${fmtNumber(data.first_month_threshold, 0)}% in month one</div>
        <div class="value">${data.first_month_winners.length}</div>
        <div class="meta">out of ${data.sample_size} sampled deals</div>
      </div>
      <div class="tile">
        <div class="label">Sectors represented</div>
        <div class="value">${data.sector_performance.length}</div>
        <div class="meta">from ${data.total_available} priced IPOs available</div>
      </div>
    </div>
    <div class="note" style="margin:-10px 0 20px">${data.excluded_spacs
      ? `Excluding ${data.spacs_in_window} SPAC / blank-check listings — they price at a flat $10 and have no operating sector, so they'd distort these averages.`
      : `Including SPACs (${data.spacs_in_window} in this window).`}</div>`;

  const chart = data.sector_performance.length
    ? `<h3 style="font-size:15px;margin:0 0 2px">Average return since IPO, by sector</h3>
       <p class="sub">Each bar is the mean % change from offer price to today for that sector's IPOs in the sample.</p>
       <div class="chart-wrap">${sectorChart(data.sector_performance)}</div>`
    : '<div class="state">Not enough sector data in this sample.</div>';

  const winners = data.first_month_winners.length
    ? `<h3 style="font-size:15px;margin:26px 0 2px">First-month gainers over ${fmtNumber(data.first_month_threshold, 0)}%</h3>
       <p class="sub">Measured from the offer price to the close roughly 21 trading days later.</p>
       <div class="table-scroll"><table>
         <thead><tr><th>Ticker</th><th>Company</th><th>IPO date</th><th>IPO price</th>
           <th>1st month %</th><th>% since IPO</th><th>Sector</th></tr></thead>
         <tbody>${data.first_month_winners.map((r) => `
           <tr class="deal-row" data-symbol="${escapeHtml(r.symbol || '')}"
               data-date="${escapeHtml(r.ipo_date)}" data-name="${escapeHtml(r.name)}" tabindex="0">
             <td class="ticker">${escapeHtml(r.symbol)}</td>
             <td class="company">${escapeHtml(r.name)}</td>
             <td>${escapeHtml(r.ipo_date)}</td>
             <td class="num">${r.ipo_price ? `$${fmtNumber(r.ipo_price)}` : '—'}</td>
             <td class="num ${dirClass(r.pct_change_first_month)}">${dirGlyph(r.pct_change_first_month)}${fmtPct(r.pct_change_first_month)}</td>
             <td class="num ${dirClass(r.pct_change_since_ipo)}">${dirGlyph(r.pct_change_since_ipo)}${fmtPct(r.pct_change_since_ipo)}</td>
             <td>${escapeHtml(r.sector)}</td>
           </tr>`).join('')}</tbody>
       </table></div>`
    : `<div class="state">No IPO in this sample gained more than ${fmtNumber(data.first_month_threshold, 0)}% in its first month.</div>`;

  const everyIpo = data.all_ipos && data.all_ipos.length
    ? `<h3 style="font-size:15px;margin:26px 0 2px">Every IPO in the sample (${data.all_ipos.length})</h3>
       <p class="sub">The whole sample, newest first &mdash; including deals that cleared no threshold and
         deals Yahoo Finance has no prices for. ${data.scored_size} of ${data.sample_size} have usable
         price data.</p>
       <div class="table-scroll"><table>
         <thead><tr><th>Ticker</th><th>Company</th><th>IPO date</th><th>IPO price</th>
           <th>Current</th><th>Day 1</th><th>1st month</th><th>Since IPO</th><th>Sector</th></tr></thead>
         <tbody>${data.all_ipos.map((r) => `
           <tr class="deal-row" data-symbol="${escapeHtml(r.symbol || '')}"
               data-date="${escapeHtml(r.ipo_date)}" data-name="${escapeHtml(r.name)}" tabindex="0">
             <td class="ticker">${escapeHtml(r.symbol || '—')}</td>
             <td class="company">${escapeHtml(r.name)}
               ${r.beat_threshold ? `<span class="pill pill-upcoming">&#9650; ${fmtNumber(data.first_month_threshold, 0)}%+ month 1</span>` : ''}
               ${r.is_spac ? ' <span class="pill">SPAC</span>' : ''}
               ${r.enrichment_status === 'no_market_data' ? ' <span class="pill">no market data</span>' : ''}</td>
             <td>${escapeHtml(r.ipo_date)}</td>
             <td class="num">${r.ipo_price ? `$${fmtNumber(r.ipo_price)}` : '—'}</td>
             <td class="num">${r.current_price ? `$${fmtNumber(r.current_price)}` : '—'}</td>
             <td class="num ${dirClass(r.pct_change_day1)}">${dirGlyph(r.pct_change_day1)}${fmtPct(r.pct_change_day1)}</td>
             <td class="num ${dirClass(r.pct_change_first_month)}">${dirGlyph(r.pct_change_first_month)}${fmtPct(r.pct_change_first_month)}</td>
             <td class="num ${dirClass(r.pct_change_since_ipo)}">${dirGlyph(r.pct_change_since_ipo)}${fmtPct(r.pct_change_since_ipo)}</td>
             <td>${escapeHtml(r.sector)}</td>
           </tr>`).join('')}</tbody>
       </table></div>
       <div class="note">A dash means one of three things: Finnhub published no offer price for the
         deal (so no percentage can be computed &mdash; the IPO price column will be blank too), the
         milestone hasn't been reached yet because the company listed too recently, or Yahoo Finance
         has no data for the ticker, usually a company since delisted, acquired or renamed.</div>`
    : '';

  return warningBlock(data.warnings) + tiles + chart + winners + everyIpo;
}

/* Diverging horizontal bars around a zero baseline.
   Direction is carried by bar side + signed label, so color is never the only channel. */
function sectorChart(rows) {
  const W = 820;
  const rowH = 30;
  const barH = 18;
  const gutter = 168;
  const padRight = 62;
  const top = 12;
  const H = top + rows.length * rowH + 22;

  const values = rows.map((r) => r.avg_pct_change_since_ipo);
  const maxAbs = Math.max(10, ...values.map((v) => Math.abs(v)));
  const plotLeft = gutter;
  const plotRight = W - padRight;
  const plotW = plotRight - plotLeft;
  const zeroX = plotLeft + plotW / 2;
  // Reserve room past the longest bar so the tip label never collides with the
  // sector name in the gutter.
  const labelSpace = 64;
  const scale = (v) => (v / maxAbs) * (plotW / 2 - labelSpace);

  // Rounded on the data end, square at the baseline.
  const barPath = (v, y) => {
    const len = scale(v);
    const r = 4;
    if (Math.abs(len) < r) {
      return `M ${zeroX} ${y} h ${len} v ${barH} h ${-len} Z`;
    }
    if (len > 0) {
      const x1 = zeroX + len;
      return `M ${zeroX} ${y} H ${x1 - r} Q ${x1} ${y} ${x1} ${y + r} V ${y + barH - r} Q ${x1} ${y + barH} ${x1 - r} ${y + barH} H ${zeroX} Z`;
    }
    const x1 = zeroX + len;
    return `M ${zeroX} ${y} H ${x1 + r} Q ${x1} ${y} ${x1} ${y + r} V ${y + barH - r} Q ${x1} ${y + barH} ${x1 + r} ${y + barH} H ${zeroX} Z`;
  };

  const bars = rows.map((r, i) => {
    const y = top + i * rowH + (rowH - barH) / 2;
    const v = r.avg_pct_change_since_ipo;
    const color = v >= 0 ? 'var(--good)' : 'var(--critical)';
    const tipX = zeroX + scale(v) + (v >= 0 ? 7 : -7);
    const anchor = v >= 0 ? 'start' : 'end';
    return `<g class="bar-row" data-sector="${escapeHtml(r.sector)}" data-count="${r.count}"
              data-avg="${fmtPct(v)}" data-best="${fmtPct(r.best)}" data-worst="${fmtPct(r.worst)}"
              data-median="${fmtPct(r.median_pct_change_since_ipo)}">
        <rect x="${plotLeft - gutter}" y="${top + i * rowH}" width="${W}" height="${rowH}" fill="transparent"></rect>
        <text x="${gutter - 12}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="12.5"
              fill="var(--text-secondary)">${escapeHtml(r.sector.length > 22 ? `${r.sector.slice(0, 21)}…` : r.sector)}</text>
        <path d="${barPath(v, y)}" fill="${color}"></path>
        <text x="${tipX}" y="${y + barH / 2 + 4}" text-anchor="${anchor}" font-size="12"
              font-variant-numeric="tabular-nums" fill="var(--text-secondary)">${fmtPct(v)}</text>
      </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
            aria-label="Average percent change since IPO by sector">
      <line x1="${zeroX}" y1="${top - 4}" x2="${zeroX}" y2="${top + rows.length * rowH + 2}"
            stroke="var(--baseline)" stroke-width="1"></line>
      ${bars}
      <text x="${zeroX}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--text-muted)">0%</text>
    </svg>`;
}

function wireChartTooltips() {
  const tip = $('#tooltip');
  $$('.bar-row').forEach((row) => {
    row.addEventListener('mousemove', (event) => {
      const d = row.dataset;
      tip.innerHTML = d.valuelabel
        ? `<div class="tt-title">${escapeHtml(d.sector)}</div>
           <div class="tt-row">${escapeHtml(d.valuelabel)}: ${escapeHtml(d.avg)}</div>
           <div class="tt-row">${escapeHtml(d.count)} ${escapeHtml(d.countlabel)}</div>`
        : `<div class="tt-title">${escapeHtml(d.sector)}</div>
           <div class="tt-row">Average: ${escapeHtml(d.avg)}</div>
           <div class="tt-row">Median: ${escapeHtml(d.median)}</div>
           <div class="tt-row">Best: ${escapeHtml(d.best)} · Worst: ${escapeHtml(d.worst)}</div>
           <div class="tt-row">${escapeHtml(d.count)} IPO(s)</div>`;
      tip.classList.add('show');
      tip.style.left = `${event.pageX + 14}px`;
      tip.style.top = `${event.pageY - 10}px`;
    });
    row.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

/* ---------------- refresh orchestration ---------------- */

async function refreshActiveTab(force) {
  if (state.loading) return;
  state.loading = true;
  $('#refresh-btn').disabled = true;
  setStatus('loading', force ? 'Refreshing (bypassing cache)…' : 'Refreshing…');

  try {
    if (state.tab === 'macro') {
      await Promise.all([loadIndices(force), loadFed(force)]);
    } else if (state.tab === 'upcoming') {
      await loadUpcoming(force);
    } else if (state.tab === 'history') {
      await loadHistory(force);
    } else if (state.tab === 'analysis') {
      // General metrics always refresh; the sampled breakdown below is expensive
      // and user-triggered, so it only re-runs once it's on screen.
      await loadGeneral(force);
      if (!$('#stats-content').querySelector('.state')) await loadStats();
    } else if (state.tab === 'individual') {
      if (state.individual && state.individual.symbol) await loadIndividual(force);
    }
    stampUpdated();
  } catch (err) {
    setStatus('error', `Refresh failed: ${err.message}`);
  } finally {
    state.loading = false;
    $('#refresh-btn').disabled = false;
  }
}

function restartTimer() {
  if (state.timer) clearInterval(state.timer);
  if (!$('#auto-refresh').checked) {
    setStatus('live', 'Auto-refresh off');
    return;
  }
  const seconds = Number($('#interval').value);
  state.timer = setInterval(() => refreshActiveTab(false), seconds * 1000);
  stampUpdated();
}

function switchTab(name) {
  state.tab = name;
  $$('.tab').forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.tab === name)));
  $$('.panel').forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });

  // Lazy-load a tab the first time it's opened.
  const content = {
    upcoming: '#upcoming-content',
    history: '#history-content',
    analysis: '#general-content',
  }[name];
  if (content && $(content).textContent.includes('Loading')) {
    refreshActiveTab(false);
  }
}

/* ---------------- wiring ---------------- */

function setUpcomingRange(daysBack, daysForward) {
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  const end = new Date();
  end.setDate(end.getDate() + daysForward);
  $('#up-start').value = clampToCoverage(isoDate(start));
  $('#up-end').value = clampToCoverage(isoDate(end));
  applyDateBounds();
}

async function init() {
  initPickers();
  // Coverage first: it sets the date pickers' bounds, which the default range clamps to.
  await loadCoverage();
  setUpcomingRange(30, 30);
  refreshPickerLabels();

  $$('.tab').forEach((btn) => { btn.onclick = () => switchTab(btn.dataset.tab); });
  $('#refresh-btn').onclick = () => refreshActiveTab(true);
  $('#auto-refresh').onchange = restartTimer;
  $('#interval').onchange = restartTimer;

  $$('#up-presets button').forEach((btn) => {
    btn.onclick = () => {
      $$('#up-presets button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      setUpcomingRange(Number(btn.dataset.back), Number(btn.dataset.fwd));
      state.calendarPage = 0;
      loadUpcoming(false);
    };
  });

  $('#up-apply').onclick = () => { state.calendarPage = 0; loadUpcoming(false); };
  $('#up-q').oninput = debounce(() => { state.calendarPage = 0; loadUpcoming(false); });

  // Re-clamp the moment a date changes, so an out-of-range value never sticks.
  ['#up-start', '#up-end'].forEach((sel) => {
    $(sel).onchange = (event) => {
      applyDateBounds(event.target);
      state.calendarPage = 0;
      loadUpcoming(false);
    };
  });
  ['#hist-start', '#hist-end'].forEach((sel) => {
    $(sel).onchange = (event) => {
      applyDateBounds(event.target);
      state.history.page = 1;
      loadHistory(false);
    };
  });
  $('#hist-years').onchange = () => applyDateBounds();

  const searchHistory = debounce(() => {
    state.history.page = 1;
    loadHistory(false);
  });
  $('#hist-q').oninput = searchHistory;

  $$('#up-view button').forEach((btn) => {
    btn.onclick = () => {
      $$('#up-view button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      state.upcomingView = btn.dataset.view;
      loadUpcoming(false);
    };
  });

  $('#hist-apply').onclick = () => {
    state.history.page = 1;
    state.exchangesLoaded = false;
    loadHistory(false);
  };
  $('#stats-apply').onclick = () => loadStats();
  $('#gen-apply').onclick = () => loadGeneral(true, true);
  $('#gen-no-spacs').onchange = () => loadGeneral(false, true);
  $('#ind-q').oninput = debounce(searchIndividual);

  switchTab('macro');
  refreshActiveTab(false);
  restartTimer();
}

document.addEventListener('DOMContentLoaded', init);
