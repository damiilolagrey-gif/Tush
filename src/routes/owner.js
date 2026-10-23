import { Router } from 'express';
import { html, page, publicHeader } from '../html.js';
import { CATEGORIES, CITIES, DEFAULT_HOURS, transaction } from '../db.js';
import { clearSessionCookie, createSessionToken, hashPassword, sessionCookie, verifyPassword } from '../auth.js';
import { activeStaff, BookingError, createBooking, markPaid } from '../booking.js';
import { BOOKING_SELECT, dashboardStats } from '../stats.js';
import {
  addDays, displayPhone, fmtDate, fmtDuration, fmtTime, formatNaira, fromMin, isDate, isTime, monthStart,
  normalizePhone, nowWAT, pct, slugify, toMin, waLink, weekday,
} from '../util.js';
import { done, ownerPage, PAYMENT_LABEL, paymentBadge, reminderText, STATUS_LABEL, statusBadge } from './layout.js';
import { manageRoutes } from './manage.js';

function revenueChart(daily) {
  const W = 640;
  const H = 180;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const max = Math.max(...daily.map((d) => d.total), 1);
  const bw = (W - pad.l - pad.r) / daily.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily revenue for the last 30 days">
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" class="axis"/>
    ${daily.map((d, i) => {
      const x = pad.l + i * bw;
      const h = H - pad.b - y(d.total);
      return html`<g><rect x="${x + 2}" y="${y(d.total)}" width="${Math.max(bw - 4, 1)}" height="${Math.max(h, d.total ? 2 : 0)}" rx="3" class="bar"/>
        <rect x="${x}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" class="hit"><title>${fmtDate(d.day)}: ${formatNaira(d.total)}</title></rect>
        ${i % 7 === 0 || (i === daily.length - 1 && i % 7 >= 4) ? html`<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${fmtDate(d.day, { day: 'numeric', month: 'short' })}</text>` : ''}</g>`;
    })}
  </svg>`;
}

function bookingRowActions(b, bizName) {
  return html`<div class="row-actions">
    ${b.status === 'confirmed' ? html`<form method="post" action="/dashboard/bookings/${b.id}/status"><input type="hidden" name="status" value="completed"><button class="btn btn-xs">Complete</button></form>` : ''}
    ${b.payment_status === 'unpaid' && b.status !== 'cancelled' ? html`<a class="btn btn-xs btn-ghost" href="/dashboard/bookings/${b.id}#payment">Take payment</a>` : ''}
    <a class="btn btn-xs btn-wa" href="${waLink(b.customer_phone, reminderText(b, bizName))}" target="_blank" rel="noopener" title="Send WhatsApp reminder">WhatsApp</a>
  </div>`;
}

export function ownerRoutes({ db, cfg }) {
  const r = Router();
  const now = () => cfg.now?.() ?? nowWAT();

  const authPage = (req, title, form, error) => page({
    title, error,
    body: html`${publicHeader(null)}<main class="container auth"><div class="card form">${form}</div></main>`,
  });

  const loginForm = (values = {}) => html`<h1>Welcome back</h1>
    <p class="muted">Log in to manage your bookings.</p>
    <form method="post" action="/login" class="form">
      <input type="hidden" name="next" value="${values.next || ''}">
      <label>Email<input type="email" name="email" required autocomplete="email" value="${values.email || ''}"></label>
      <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
      <button class="btn btn-block">Log in</button>
    </form>
    <p class="small center">New here? <a href="/signup">List your business</a></p>`;

  const signupForm = (v = {}) => html`<h1>List your business</h1>
    <p class="muted">Start taking online bookings in minutes.</p>
    <form method="post" action="/signup" class="form">
      <label>Your name<input name="name" required autocomplete="name" value="${v.name || ''}"></label>
      <label>Email<input type="email" name="email" required autocomplete="email" value="${v.email || ''}"></label>
      <label>Password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <label>Business name<input name="business" required value="${v.business || ''}"></label>
      <div class="two">
        <label>Category<select name="category">${CATEGORIES.map((c) => html`<option ${c === v.category ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label>City<select name="city">${CITIES.map((c) => html`<option ${c === v.city ? 'selected' : ''}>${c}</option>`)}</select></label>
      </div>
      <label>Area / neighbourhood<input name="area" placeholder="e.g. Lekki Phase 1" value="${v.area || ''}"></label>
      <label>Business phone (WhatsApp)<input name="phone" type="tel" required placeholder="0803 123 4567" value="${v.phone || ''}"></label>
      <button class="btn btn-block">Create account</button>
    </form>
    <p class="small center">Already have an account? <a href="/login">Log in</a></p>`;

  const login = (res, userId) => res.append('Set-Cookie', sessionCookie(createSessionToken(userId, cfg.sessionSecret), cfg.secureCookies));
  const safeNext = (n) => (typeof n === 'string' && /^\/dashboard(\/|$|\?)/.test(n) ? n : '/dashboard');

  r.get('/login', (req, res) => (req.user ? res.redirect('/dashboard') : res.send(authPage(req, 'Log in', loginForm({ next: req.query.next })))));

  r.post('/login', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(req.body.email || '').trim());
    if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
      return res.status(401).send(authPage(req, 'Log in', loginForm(req.body), 'Wrong email or password.'));
    }
    login(res, user.id);
    res.redirect(303, safeNext(req.body.next));
  });

  r.post('/logout', (req, res) => {
    res.append('Set-Cookie', clearSessionCookie);
    res.redirect(303, '/');
  });

  r.get('/signup', (req, res) => (req.user ? res.redirect('/dashboard') : res.send(authPage(req, 'List your business', signupForm()))));

  r.post('/signup', (req, res) => {
    const v = req.body;
    const email = String(v.email || '').trim().toLowerCase();
    const phone = normalizePhone(v.phone);
    const fail = (msg) => res.status(422).send(authPage(req, 'List your business', signupForm(v), msg));
    if (!String(v.name || '').trim() || !String(v.business || '').trim()) return fail('Please fill in your name and business name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Please enter a valid email.');
    if (String(v.password || '').length < 8) return fail('Password must be at least 8 characters.');
    if (!phone) return fail('Please enter a valid Nigerian phone number.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail('An account with that email already exists. Try logging in.');

    const userId = transaction(db, () => {
      const id = Number(db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
        .run(v.name.trim(), email, hashPassword(v.password)).lastInsertRowid);
      let slug = slugify(v.business);
      for (let i = 2; db.prepare('SELECT 1 FROM businesses WHERE slug = ?').get(slug); i++) slug = `${slugify(v.business)}-${i}`;
      const bizId = Number(db.prepare(`INSERT INTO businesses (owner_id, slug, name, category, city, area, phone, whatsapp, hours)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, slug, v.business.trim(),
        CATEGORIES.includes(v.category) ? v.category : CATEGORIES[0], CITIES.includes(v.city) ? v.city : CITIES[0],
        String(v.area || '').trim(), phone, phone, JSON.stringify(DEFAULT_HOURS)).lastInsertRowid);
      db.prepare('INSERT INTO staff (business_id, name, role) VALUES (?, ?, ?)').run(bizId, v.name.trim().split(' ')[0], 'Owner');
      return id;
    });
    login(res, userId);
    done(res, '/dashboard/services', 'Welcome! Add your first service to start taking bookings.');
  });

  // Everything below needs a logged-in owner.
  r.use('/dashboard', (req, res, next) => {
    if (!req.user || !req.business) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    next();
  });

  r.get('/dashboard', (req, res) => {
    const biz = req.business;
    const today = now().slice(0, 10);
    const s = dashboardStats(db, biz.id, today);
    const todays = db.prepare(`${BOOKING_SELECT} WHERE b.business_id = ? AND substr(b.starts_at, 1, 10) = ? AND b.status <> 'cancelled' ORDER BY b.starts_at`).all(biz.id, today);
    const upcoming = db.prepare(`${BOOKING_SELECT} WHERE b.business_id = ? AND substr(b.starts_at, 1, 10) > ? AND b.status = 'confirmed' ORDER BY b.starts_at LIMIT 6`).all(biz.id, today);
    const serviceCount = db.prepare('SELECT COUNT(*) AS n FROM services WHERE business_id = ? AND active = 1').get(biz.id).n;
    const change = s.revenue.lastMonthToDate ? Math.round(((s.revenue.month - s.revenue.lastMonthToDate) / s.revenue.lastMonthToDate) * 100) : null;
    const cancelRate = pct((s.statusCounts.cancelled || 0) + (s.statusCounts.no_show || 0), s.monthBookings);
    const todayRevenueExpected = todays.reduce((a, b) => a + b.price_kobo, 0);
    const totalMix = s.paymentMix.reduce((a, m) => a + m.total, 0);

    res.send(ownerPage(req, {
      title: `Good ${Number(now().slice(11, 13)) < 12 ? 'morning' : Number(now().slice(11, 13)) < 17 ? 'afternoon' : 'evening'}, ${req.user.name.split(' ')[0]}`,
      active: 'overview',
      actions: html`<a class="btn" href="/dashboard/bookings/new">+ New booking</a>`,
      body: html`
${serviceCount ? '' : html`<div class="card onboarding"><h2>Get set up</h2><ol>
  <li><a href="/dashboard/services">Add your services and prices</a></li>
  <li><a href="/dashboard/staff">Add your team</a></li>
  <li><a href="/dashboard/settings">Set your opening hours</a></li>
  <li>Share your booking link: <code>${cfg.baseUrl}/b/${biz.slug}</code></li></ol></div>`}
<div class="kpis">
  <div class="kpi"><span>Revenue today</span><strong>${formatNaira(s.revenue.today)}</strong><small>${todays.length} appointments · ${formatNaira(todayRevenueExpected)} booked</small></div>
  <div class="kpi"><span>This week</span><strong>${formatNaira(s.revenue.week)}</strong><small>Since Monday</small></div>
  <div class="kpi"><span>This month</span><strong>${formatNaira(s.revenue.month)}</strong>
    <small>${change === null ? 'No data for last month' : html`<span class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%</span> vs same days last month`}</small></div>
  <div class="kpi"><span>Outstanding</span><strong>${formatNaira(s.outstanding.total)}</strong><small>${s.outstanding.n} completed, not yet paid</small></div>
</div>
<div class="kpis kpis-sm">
  <div class="kpi"><span>Bookings this month</span><strong>${s.monthBookings}</strong></div>
  <div class="kpi"><span>Upcoming</span><strong>${s.upcomingCount}</strong></div>
  <div class="kpi"><span>Average sale</span><strong>${formatNaira(s.avgTicket)}</strong></div>
  <div class="kpi"><span>Returning clients</span><strong>${pct(s.customers.returning_count, s.customers.total)}%</strong></div>
  <div class="kpi"><span>Cancel + no-show</span><strong>${cancelRate}%</strong></div>
</div>
<div class="dash-grid">
  <section class="card span-2">
    <div class="card-head"><h2>Revenue, last 30 days</h2><a class="small" href="/dashboard/bookings?${new URLSearchParams({ from: addDays(today, -29), to: today, payment: 'paid' })}">See sales</a></div>
    ${revenueChart(s.daily)}
  </section>
  <section class="card span-2">
    <div class="card-head"><h2>Today · ${fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</h2><a class="small" href="/dashboard/calendar">Open calendar</a></div>
    ${todays.length ? html`<ul class="appt-list">${todays.map((b) => html`<li>
      <a class="appt-time" href="/dashboard/bookings/${b.id}">${fmtTime(b.starts_at.slice(11))}</a>
      <div class="appt-main"><a href="/dashboard/bookings/${b.id}"><strong>${b.customer_name}</strong></a>
        <span class="muted small">${b.service_name} · ${b.staff_name} · ${formatNaira(b.price_kobo)}</span>
        <span>${statusBadge(b.status)} ${paymentBadge(b)}</span></div>
      ${bookingRowActions(b, biz.name)}</li>`)}</ul>`
      : html`<p class="muted">No appointments today.</p>`}
  </section>
  <section class="card">
    <h2>Top services this month</h2>
    ${s.topServices.length ? html`<table class="mini"><tr><th>Service</th><th>Bookings</th><th>Revenue</th></tr>
      ${s.topServices.map((t) => html`<tr><td>${t.name}</td><td>${t.n}</td><td>${formatNaira(t.revenue)}</td></tr>`)}</table>` : html`<p class="muted">No bookings yet.</p>`}
  </section>
  <section class="card">
    <h2>Team performance this month</h2>
    ${s.staffPerformance.length ? html`<table class="mini"><tr><th>Team member</th><th>Bookings</th><th>Revenue</th></tr>
      ${s.staffPerformance.map((t) => html`<tr><td>${t.name}</td><td>${t.n}</td><td>${formatNaira(t.revenue)}</td></tr>`)}</table>` : html`<p class="muted">No bookings yet.</p>`}
  </section>
  <section class="card">
    <h2>How clients paid this month</h2>
    ${s.paymentMix.length ? html`<ul class="bars">${s.paymentMix.map((m) => html`<li>
      <div class="row"><span>${PAYMENT_LABEL[m.method] || 'Other'}</span><strong>${formatNaira(m.total)}</strong></div>
      <div class="meter"><span style="width:${pct(m.total, totalMix)}%"></span></div></li>`)}</ul>` : html`<p class="muted">No payments yet.</p>`}
  </section>
  <section class="card">
    <div class="card-head"><h2>Coming up</h2><a class="small" href="/dashboard/bookings">All bookings</a></div>
    ${upcoming.length ? html`<ul class="simple-list">${upcoming.map((b) => html`<li><a href="/dashboard/bookings/${b.id}">
      <strong>${fmtDate(b.starts_at.slice(0, 10))}, ${fmtTime(b.starts_at.slice(11))}</strong>
      <span class="muted small">${b.customer_name} · ${b.service_name}</span></a></li>`)}</ul>` : html`<p class="muted">Nothing booked yet.</p>`}
  </section>
</div>`,
    }));
  });

  r.get('/dashboard/calendar', (req, res) => {
    const biz = req.business;
    const date = isDate(req.query.date) ? req.query.date : now().slice(0, 10);
    const staff = activeStaff(db, biz.id);
    const hours = JSON.parse(biz.hours);
    const allHours = Object.values(hours).filter(Boolean);
    const dayStart = Math.floor(Math.min(...allHours.map((h) => toMin(h.open)), 8 * 60) / 60) * 60;
    const dayEnd = Math.ceil(Math.max(...allHours.map((h) => toMin(h.close)), 18 * 60) / 60) * 60;
    const bookings = db.prepare(`${BOOKING_SELECT} WHERE b.business_id = ? AND substr(b.starts_at, 1, 10) = ? ORDER BY b.starts_at`).all(biz.id, date);
    const PX = 1.4; // pixels per minute
    const today = hours[weekday(date)];
    const nowMin = date === now().slice(0, 10) ? toMin(now().slice(11)) : null;

    res.send(ownerPage(req, {
      title: 'Calendar',
      active: 'calendar',
      actions: html`<a class="btn" href="/dashboard/bookings/new?date=${date}">+ New booking</a>`,
      body: html`<div class="cal-nav card">
  <a class="btn btn-ghost btn-sm" href="?date=${addDays(date, -1)}" aria-label="Previous day">←</a>
  <form method="get"><input type="date" name="date" value="${date}" data-autosubmit aria-label="Date"></form>
  <strong>${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
  <span class="muted small">${today ? `Open ${fmtTime(today.open)} – ${fmtTime(today.close)}` : 'Closed'}</span>
  <a class="btn btn-ghost btn-sm" href="?date=${now().slice(0, 10)}">Today</a>
  <a class="btn btn-ghost btn-sm" href="?date=${addDays(date, 1)}" aria-label="Next day">→</a>
</div>
<div class="calendar card" style="--cols:${staff.length}">
  <div class="cal-header"><div></div>${staff.map((s) => html`<div><span class="avatar sm">${s.name[0]}</span>${s.name}</div>`)}</div>
  <div class="cal-body" style="height:${(dayEnd - dayStart) * PX}px">
    <div class="cal-times">${Array.from({ length: (dayEnd - dayStart) / 60 }, (_, i) => html`<div style="top:${i * 60 * PX}px">${fmtTime(fromMin(dayStart + i * 60))}</div>`)}</div>
    ${staff.map((s) => html`<div class="cal-col">
      ${today ? html`<div class="cal-closed" style="top:0;height:${Math.max(0, toMin(today.open) - dayStart) * PX}px"></div>
        <div class="cal-closed" style="top:${(toMin(today.close) - dayStart) * PX}px;bottom:0"></div>` : html`<div class="cal-closed" style="top:0;bottom:0"></div>`}
      ${bookings.filter((b) => b.staff_id === s.id).map((b) => {
        const start = toMin(b.starts_at.slice(11));
        const end = toMin(b.ends_at.slice(11));
        return html`<a class="cal-appt st-${b.status}" href="/dashboard/bookings/${b.id}" style="top:${(start - dayStart) * PX}px;height:${(end - start) * PX - 2}px">
          <strong>${fmtTime(b.starts_at.slice(11))} ${b.customer_name}</strong><span>${b.service_name}</span></a>`;
      })}
    </div>`)}
    ${nowMin !== null && nowMin >= dayStart && nowMin <= dayEnd ? html`<div class="cal-now" style="top:${(nowMin - dayStart) * PX}px"></div>` : ''}
  </div>
</div>
<p class="legend small"><span class="dot st-confirmed"></span>Confirmed <span class="dot st-completed"></span>Completed <span class="dot st-no_show"></span>No-show <span class="dot st-cancelled"></span>Cancelled</p>`,
    }));
  });

  function bookingFilters(req) {
    const today = now().slice(0, 10);
    const q = req.query;
    return {
      from: isDate(q.from) ? q.from : today,
      to: isDate(q.to) ? q.to : addDays(today, 30),
      status: Object.keys(STATUS_LABEL).includes(q.status) ? q.status : '',
      payment: ['paid', 'unpaid'].includes(q.payment) ? q.payment : '',
      q: String(q.q || '').trim(),
    };
  }

  function findBookings(bizId, f) {
    return db.prepare(`${BOOKING_SELECT}
      WHERE b.business_id = :biz AND substr(b.starts_at, 1, 10) BETWEEN :from AND :to
        AND (:status = '' OR b.status = :status) AND (:payment = '' OR b.payment_status = :payment)
        AND (:q = '' OR c.name LIKE :like OR c.phone LIKE :like OR b.ref LIKE :like OR s.name LIKE :like)
      ORDER BY b.starts_at LIMIT 2000`).all({ biz: bizId, ...f, like: `%${f.q}%` });
  }

  r.get('/dashboard/bookings', (req, res) => {
    const f = bookingFilters(req);
    const rows = findBookings(req.business.id, f);
    const today = now().slice(0, 10);
    const paid = rows.filter((b) => b.payment_status === 'paid').reduce((a, b) => a + b.price_kobo, 0);
    const quick = [
      ['Today', today, today],
      ['Next 7 days', today, addDays(today, 7)],
      ['This month', monthStart(today), today],
      ['Last 30 days', addDays(today, -29), today],
    ];
    const qs = (extra) => new URLSearchParams({ ...f, ...extra });

    res.send(ownerPage(req, {
      title: 'Bookings',
      active: 'bookings',
      actions: html`<a class="btn btn-ghost" href="/dashboard/bookings.csv?${qs({})}">Export CSV</a><a class="btn" href="/dashboard/bookings/new">+ New booking</a>`,
      body: html`<div class="chips">${quick.map(([label, from, to]) => html`<a class="chip ${f.from === from && f.to === to ? 'active' : ''}" href="?${qs({ from, to })}">${label}</a>`)}</div>
<form class="filters card" method="get">
  <label>From<input type="date" name="from" value="${f.from}"></label>
  <label>To<input type="date" name="to" value="${f.to}"></label>
  <label>Status<select name="status"><option value="">Any</option>${Object.entries(STATUS_LABEL).map(([k, v]) => html`<option value="${k}" ${k === f.status ? 'selected' : ''}>${v}</option>`)}</select></label>
  <label>Payment<select name="payment"><option value="">Any</option><option value="paid" ${f.payment === 'paid' ? 'selected' : ''}>Paid</option><option value="unpaid" ${f.payment === 'unpaid' ? 'selected' : ''}>Unpaid</option></select></label>
  <label class="grow">Search<input name="q" value="${f.q}" placeholder="Name, phone, ref or service"></label>
  <button class="btn">Filter</button>
</form>
<p class="muted small">${rows.length} bookings · ${formatNaira(paid)} paid</p>
<div class="table-wrap card"><table class="table">
  <thead><tr><th>When</th><th>Client</th><th>Service</th><th>Team</th><th>Price</th><th>Status</th><th>Payment</th></tr></thead>
  <tbody>${rows.length ? rows.map((b) => html`<tr data-href="/dashboard/bookings/${b.id}">
    <td><a href="/dashboard/bookings/${b.id}">${fmtDate(b.starts_at.slice(0, 10))}<br><span class="muted small">${fmtTime(b.starts_at.slice(11))}</span></a></td>
    <td>${b.customer_name}<br><span class="muted small">${displayPhone(b.customer_phone)}</span></td>
    <td>${b.service_name}</td><td>${b.staff_name}</td><td>${formatNaira(b.price_kobo)}</td>
    <td>${statusBadge(b.status)}</td><td>${paymentBadge(b)}</td></tr>`)
    : html`<tr><td colspan="7" class="muted center">No bookings match these filters.</td></tr>`}</tbody>
</table></div>`,
    }));
  });

  r.get('/dashboard/bookings.csv', (req, res) => {
    const f = bookingFilters(req);
    const cell = (v) => {
      const s = String(v ?? '');
      // Prefix formula-like values so spreadsheets don't execute them.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [['Ref', 'Date', 'Time', 'Client', 'Phone', 'Service', 'Team member', 'Price (NGN)', 'Status', 'Payment', 'Method', 'Source']]
      .concat(findBookings(req.business.id, f).map((b) => [b.ref, b.starts_at.slice(0, 10), b.starts_at.slice(11), b.customer_name,
        displayPhone(b.customer_phone), b.service_name, b.staff_name, (b.price_kobo / 100).toFixed(2), STATUS_LABEL[b.status],
        b.payment_status, PAYMENT_LABEL[b.payment_method] || '', b.source]));
    res.type('text/csv').attachment(`bookings-${f.from}-to-${f.to}.csv`).send(lines.map((l) => l.map(cell).join(',')).join('\n'));
  });

  function newBookingForm(req, v = {}) {
    const biz = req.business;
    const services = db.prepare('SELECT * FROM services WHERE business_id = ? AND active = 1 ORDER BY name').all(biz.id);
    const staff = activeStaff(db, biz.id);
    const n = now();
    const nextSlot = fromMin(Math.min(Math.ceil((toMin(n.slice(11)) + 1) / 30) * 30, 23 * 60 + 30));
    return html`<form method="post" action="/dashboard/bookings" class="form card narrow-form">
  ${services.length ? '' : html`<p class="notice">Add a service first on the <a href="/dashboard/services">Services</a> page.</p>`}
  <div class="two">
    <label>Service<select name="service" required>${services.map((s) => html`<option value="${s.id}" ${String(s.id) === v.service ? 'selected' : ''}>${s.name} · ${formatNaira(s.price_kobo)} · ${fmtDuration(s.duration_min)}</option>`)}</select></label>
    <label>Team member<select name="staff" required>${staff.map((s) => html`<option value="${s.id}" ${String(s.id) === v.staff ? 'selected' : ''}>${s.name}</option>`)}</select></label>
  </div>
  <div class="two">
    <label>Date<input type="date" name="date" required value="${v.date || req.query.date || n.slice(0, 10)}"></label>
    <label>Time<input type="time" name="time" required step="300" value="${v.time || nextSlot}"></label>
  </div>
  <div class="two">
    <label>Client name<input name="name" required value="${v.name || ''}"></label>
    <label>Client phone<input name="phone" type="tel" required placeholder="0803 123 4567" value="${v.phone || ''}"></label>
  </div>
  <div class="two">
    <label>Booked via<select name="source"><option value="walk_in">Walk-in</option><option value="phone" ${v.source === 'phone' ? 'selected' : ''}>Phone / WhatsApp</option></select></label>
    <label>Paid already?<select name="paid"><option value="">Not yet</option>${Object.entries(PAYMENT_LABEL).filter(([k]) => k !== 'paystack').map(([k, l]) => html`<option value="${k}" ${v.paid === k ? 'selected' : ''}>Yes, ${l.toLowerCase()}</option>`)}</select></label>
  </div>
  <label>Notes<textarea name="notes" rows="2">${v.notes || ''}</textarea></label>
  <button class="btn btn-lg">Save booking</button>
</form>`;
  }

  r.get('/dashboard/bookings/new', (req, res) => {
    res.send(ownerPage(req, { title: 'New booking', active: 'bookings', body: newBookingForm(req) }));
  });

  r.post('/dashboard/bookings', (req, res) => {
    const v = req.body;
    try {
      if (!isDate(v.date) || !isTime(v.time)) throw new BookingError('Please choose a valid date and time.');
      const ref = createBooking(db, req.business, {
        serviceId: v.service, staffId: v.staff, date: v.date, time: v.time, name: v.name, phone: v.phone,
        notes: v.notes, source: v.source === 'phone' ? 'phone' : 'walk_in',
      }, { ignoreHours: true });
      const b = db.prepare('SELECT id FROM bookings WHERE ref = ?').get(ref);
      if (['cash', 'transfer', 'pos'].includes(v.paid)) markPaid(db, b.id, v.paid);
      done(res, `/dashboard/bookings/${b.id}`, 'Booking saved');
    } catch (err) {
      if (!(err instanceof BookingError)) throw err;
      res.status(422).send(ownerPage(req, { title: 'New booking', active: 'bookings', error: err.message, body: newBookingForm(req, v) }));
    }
  });

  const ownBooking = (req) => db.prepare(`${BOOKING_SELECT} WHERE b.id = ? AND b.business_id = ?`).get(Number(req.params.id), req.business.id);

  r.get('/dashboard/bookings/:id', (req, res, next) => {
    const b = ownBooking(req);
    if (!b) return next();
    const biz = req.business;
    const visits = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE customer_id = ? AND status = 'completed'").get(b.customer_id).n;
    const statusButton = (status, label, cls = 'btn-ghost') => html`<form method="post" action="/dashboard/bookings/${b.id}/status">
      <input type="hidden" name="status" value="${status}"><button class="btn ${cls}">${label}</button></form>`;
    const confirmText = `Hello ${b.customer_name.split(' ')[0]}, your ${b.service_name} appointment at ${biz.name} is confirmed for ${fmtDate(b.starts_at.slice(0, 10))} at ${fmtTime(b.starts_at.slice(11))}. Ref: ${b.ref}. View or cancel: ${cfg.baseUrl}/booking/${b.ref}`;

    res.send(ownerPage(req, {
      title: `${b.customer_name} · ${b.service_name}`,
      active: 'bookings',
      actions: html`<a class="btn btn-ghost" href="/dashboard/calendar?date=${b.starts_at.slice(0, 10)}">View in calendar</a>`,
      body: html`<div class="detail-grid">
  <section class="card stack">
    <div class="row"><span class="muted">Reference</span><strong class="mono">${b.ref}</strong></div>
    <div class="row"><span class="muted">When</span><strong>${fmtDate(b.starts_at.slice(0, 10), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(b.starts_at.slice(11))} – ${fmtTime(b.ends_at.slice(11))}</strong></div>
    <div class="row"><span class="muted">Service</span><span>${b.service_name} (${fmtDuration(b.duration_min)})</span></div>
    <div class="row"><span class="muted">Team member</span><span>${b.staff_name}</span></div>
    <div class="row"><span class="muted">Price</span><strong>${formatNaira(b.price_kobo)}</strong></div>
    <div class="row"><span class="muted">Status</span>${statusBadge(b.status)}</div>
    <div class="row"><span class="muted">Booked via</span><span>${{ online: 'Online booking page', walk_in: 'Walk-in', phone: 'Phone / WhatsApp' }[b.source]}</span></div>
    ${b.notes ? html`<div class="notice">${b.notes}</div>` : ''}
    <div class="actions wrap">
      ${b.status === 'confirmed' ? html`${statusButton('completed', 'Mark completed', '')}${statusButton('no_show', 'No-show')}${statusButton('cancelled', 'Cancel booking')}` : ''}
      ${b.status !== 'confirmed' ? statusButton('confirmed', 'Reopen as confirmed') : ''}
    </div>
  </section>
  <section class="card stack" id="payment">
    <h2>Payment</h2>
    <div class="row"><span class="muted">Status</span>${paymentBadge(b)}</div>
    ${b.paid_at ? html`<div class="row"><span class="muted">Paid at</span><span>${b.paid_at} UTC</span></div>` : ''}
    ${b.payment_status === 'unpaid' && b.status !== 'cancelled' ? html`<form method="post" action="/dashboard/bookings/${b.id}/payment" class="form">
      <label>How did they pay?<select name="method">${Object.entries(PAYMENT_LABEL).filter(([k]) => k !== 'paystack').map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
      <button class="btn btn-block">Record ${formatNaira(b.price_kobo)} payment</button></form>` : ''}
    <h2>Client</h2>
    <a href="/dashboard/customers/${b.customer_id}"><strong>${b.customer_name}</strong></a>
    <span class="muted">${displayPhone(b.customer_phone)} · ${visits} completed visits</span>
    <div class="actions wrap">
      <a class="btn btn-wa" href="${waLink(b.customer_phone, confirmText)}" target="_blank" rel="noopener">Send confirmation</a>
      <a class="btn btn-wa" href="${waLink(b.customer_phone, reminderText(b, biz.name))}" target="_blank" rel="noopener">Send reminder</a>
      <a class="btn btn-ghost" href="tel:${b.customer_phone}">Call</a>
    </div>
  </section>
</div>`,
    }));
  });

  r.post('/dashboard/bookings/:id/status', (req, res, next) => {
    const b = ownBooking(req);
    if (!b) return next();
    const status = req.body.status;
    if (!Object.keys(STATUS_LABEL).includes(status)) return done(res, `/dashboard/bookings/${b.id}`);
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, b.id);
    done(res, req.get('referer')?.includes('/dashboard/bookings/') ? `/dashboard/bookings/${b.id}` : '/dashboard', `Marked ${STATUS_LABEL[status].toLowerCase()}`);
  });

  r.post('/dashboard/bookings/:id/payment', (req, res, next) => {
    const b = ownBooking(req);
    if (!b) return next();
    if (['cash', 'transfer', 'pos'].includes(req.body.method)) markPaid(db, b.id, req.body.method);
    done(res, `/dashboard/bookings/${b.id}`, 'Payment recorded');
  });

  r.use(manageRoutes({ db, cfg }));

  return r;
}

