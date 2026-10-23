import { Router } from 'express';
import { html } from '../html.js';
import { CATEGORIES, CITIES } from '../db.js';
import { BOOKING_SELECT } from '../stats.js';
import { displayPhone, fmtDate, fmtDuration, fmtTime, formatNaira, isTime, normalizePhone, parseNaira, toMin, waLink } from '../util.js';
import { done, ownerPage, paymentBadge, statusBadge } from './layout.js';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360];

export function manageRoutes({ db, cfg }) {
  const r = Router();

  // ---- Services ----
  function serviceFields(s = {}) {
    return html`<label class="grow">Service name<input name="name" required maxlength="80" value="${s.name || ''}" placeholder="e.g. Knotless braids (medium)"></label>
      <label>Duration<select name="duration">${DURATIONS.map((d) => html`<option value="${d}" ${d === (s.duration_min || 60) ? 'selected' : ''}>${fmtDuration(d)}</option>`)}</select></label>
      <label>Price (₦)<input name="price" required inputmode="numeric" value="${s.price_kobo != null ? s.price_kobo / 100 : ''}" placeholder="15000"></label>
      <label class="grow">Short description <span class="muted">(optional)</span><input name="description" maxlength="140" value="${s.description || ''}"></label>`;
  }

  function readService(body) {
    const name = String(body.name || '').trim();
    const duration = Number(body.duration);
    const price = parseNaira(body.price);
    if (!name || !DURATIONS.includes(duration) || price === null) return null;
    return { name, duration, price, description: String(body.description || '').trim() };
  }

  r.get('/dashboard/services', (req, res) => {
    const services = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.service_id = s.id AND b.status <> 'cancelled') AS bookings
      FROM services s WHERE s.business_id = ? ORDER BY s.active DESC, s.name`).all(req.business.id);
    res.send(ownerPage(req, {
      title: 'Services',
      active: 'services',
      body: html`<form method="post" action="/dashboard/services" class="card form inline-form">
  <h2>Add a service</h2>
  <div class="fields">${serviceFields()}</div>
  <button class="btn">Add service</button>
</form>
<div class="table-wrap card"><table class="table">
  <thead><tr><th>Service</th><th>Duration</th><th>Price</th><th>Bookings</th><th></th></tr></thead>
  <tbody>${services.map((s) => html`<tr class="${s.active ? '' : 'inactive'}">
    <td><strong>${s.name}</strong>${s.description ? html`<br><span class="muted small">${s.description}</span>` : ''}${s.active ? '' : html` <span class="badge badge-cancelled">Hidden</span>`}</td>
    <td>${fmtDuration(s.duration_min)}</td><td>${formatNaira(s.price_kobo)}</td><td>${s.bookings}</td>
    <td class="right"><a class="btn btn-xs btn-ghost" href="/dashboard/services/${s.id}">Edit</a></td></tr>`)}</tbody>
</table></div>`,
    }));
  });

  r.post('/dashboard/services', (req, res) => {
    const s = readService(req.body);
    if (!s) return done(res, '/dashboard/services', 'Please enter a name and a valid price.');
    db.prepare('INSERT INTO services (business_id, name, duration_min, price_kobo, description) VALUES (?, ?, ?, ?, ?)')
      .run(req.business.id, s.name, s.duration, s.price, s.description);
    done(res, '/dashboard/services', `Added ${s.name}`);
  });

  const ownService = (req) => db.prepare('SELECT * FROM services WHERE id = ? AND business_id = ?').get(Number(req.params.id), req.business.id);

  r.get('/dashboard/services/:id', (req, res, next) => {
    const s = ownService(req);
    if (!s) return next();
    res.send(ownerPage(req, {
      title: `Edit ${s.name}`,
      active: 'services',
      body: html`<form method="post" action="/dashboard/services/${s.id}" class="card form narrow-form">
  ${serviceFields(s)}
  <label class="check"><input type="checkbox" name="active" value="1" ${s.active ? 'checked' : ''}> Show on booking page</label>
  <p class="muted small">Price changes apply to new bookings only. Existing bookings keep the price they were booked at.</p>
  <div class="actions"><button class="btn">Save</button><a class="btn btn-ghost" href="/dashboard/services">Back</a></div>
</form>`,
    }));
  });

  r.post('/dashboard/services/:id', (req, res, next) => {
    const existing = ownService(req);
    if (!existing) return next();
    const s = readService(req.body);
    if (!s) return done(res, `/dashboard/services/${existing.id}`, 'Please enter a name and a valid price.');
    db.prepare('UPDATE services SET name = ?, duration_min = ?, price_kobo = ?, description = ?, active = ? WHERE id = ?')
      .run(s.name, s.duration, s.price, s.description, req.body.active ? 1 : 0, existing.id);
    done(res, '/dashboard/services', `Saved ${s.name}`);
  });

  // ---- Team ----
  r.get('/dashboard/staff', (req, res) => {
    const staff = db.prepare(`SELECT st.*, (SELECT COUNT(*) FROM bookings b WHERE b.staff_id = st.id AND b.status = 'confirmed'
      AND b.starts_at >= datetime('now', '+1 hour')) AS upcoming FROM staff st WHERE st.business_id = ? ORDER BY st.active DESC, st.name`).all(req.business.id);
    res.send(ownerPage(req, {
      title: 'Team',
      active: 'staff',
      body: html`<form method="post" action="/dashboard/staff" class="card form inline-form">
  <h2>Add a team member</h2>
  <div class="fields">
    <label class="grow">Name<input name="name" required maxlength="60"></label>
    <label class="grow">Role<input name="role" maxlength="60" placeholder="e.g. Senior stylist"></label>
  </div>
  <button class="btn">Add</button>
</form>
<div class="table-wrap card"><table class="table">
  <thead><tr><th>Name</th><th>Role</th><th>Upcoming</th><th>Bookable</th><th></th></tr></thead>
  <tbody>${staff.map((s) => html`<tr class="${s.active ? '' : 'inactive'}">
    <td><span class="avatar sm">${s.name[0]}</span> <strong>${s.name}</strong></td><td>${s.role}</td><td>${s.upcoming}</td>
    <td>${s.active ? 'Yes' : 'No'}</td>
    <td class="right"><form method="post" action="/dashboard/staff/${s.id}/toggle"><button class="btn btn-xs btn-ghost">${s.active ? 'Pause bookings' : 'Make bookable'}</button></form></td></tr>`)}</tbody>
</table></div>
<p class="muted small">Paused team members keep their existing bookings but can't be booked online.</p>`,
    }));
  });

  r.post('/dashboard/staff', (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return done(res, '/dashboard/staff', 'Please enter a name.');
    db.prepare('INSERT INTO staff (business_id, name, role) VALUES (?, ?, ?)').run(req.business.id, name, String(req.body.role || '').trim());
    done(res, '/dashboard/staff', `Added ${name}`);
  });

  r.post('/dashboard/staff/:id/toggle', (req, res) => {
    db.prepare('UPDATE staff SET active = 1 - active WHERE id = ? AND business_id = ?').run(Number(req.params.id), req.business.id);
    done(res, '/dashboard/staff', 'Updated');
  });

  // ---- Customers ----
  r.get('/dashboard/customers', (req, res) => {
    const q = String(req.query.q || '').trim();
    const customers = db.prepare(`SELECT c.*,
        COUNT(CASE WHEN b.status = 'completed' THEN 1 END) AS visits,
        COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.price_kobo END), 0) AS spent,
        MAX(CASE WHEN b.status IN ('completed', 'confirmed') THEN b.starts_at END) AS last_seen,
        COUNT(CASE WHEN b.status = 'no_show' THEN 1 END) AS no_shows
      FROM customers c LEFT JOIN bookings b ON b.customer_id = c.id
      WHERE c.business_id = :biz AND (:q = '' OR c.name LIKE :like OR c.phone LIKE :like)
      GROUP BY c.id ORDER BY spent DESC LIMIT 500`).all({ biz: req.business.id, q, like: `%${q}%` });
    res.send(ownerPage(req, {
      title: 'Customers',
      active: 'customers',
      body: html`<form class="filters card" method="get"><label class="grow">Search<input name="q" value="${q}" placeholder="Name or phone"></label><button class="btn">Search</button></form>
<p class="muted small">${customers.length} customers, sorted by total spend</p>
<div class="table-wrap card"><table class="table">
  <thead><tr><th>Name</th><th>Phone</th><th>Visits</th><th>Total spent</th><th>Last visit</th><th>No-shows</th></tr></thead>
  <tbody>${customers.map((c) => html`<tr>
    <td><a href="/dashboard/customers/${c.id}"><strong>${c.name}</strong></a></td><td>${displayPhone(c.phone)}</td>
    <td>${c.visits}</td><td>${formatNaira(c.spent)}</td><td>${c.last_seen ? fmtDate(c.last_seen.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
    <td>${c.no_shows ? html`<span class="badge badge-no_show">${c.no_shows}</span>` : '0'}</td></tr>`)}</tbody>
</table></div>`,
    }));
  });

  r.get('/dashboard/customers/:id', (req, res, next) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(Number(req.params.id), req.business.id);
    if (!c) return next();
    const history = db.prepare(`${BOOKING_SELECT} WHERE b.customer_id = ? ORDER BY b.starts_at DESC`).all(c.id);
    const spent = history.filter((b) => b.payment_status === 'paid').reduce((a, b) => a + b.price_kobo, 0);
    res.send(ownerPage(req, {
      title: c.name,
      active: 'customers',
      actions: html`<a class="btn btn-wa" href="${waLink(c.phone, `Hello ${c.name.split(' ')[0]}, `)}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="btn" href="/dashboard/bookings/new">+ New booking</a>`,
      body: html`<div class="kpis kpis-sm">
  <div class="kpi"><span>Phone</span><strong class="small-strong">${displayPhone(c.phone)}</strong></div>
  <div class="kpi"><span>Visits</span><strong>${history.filter((b) => b.status === 'completed').length}</strong></div>
  <div class="kpi"><span>Total spent</span><strong>${formatNaira(spent)}</strong></div>
  <div class="kpi"><span>Client since</span><strong class="small-strong">${fmtDate(c.created_at.slice(0, 10), { month: 'short', year: 'numeric' })}</strong></div>
</div>
<div class="table-wrap card"><table class="table">
  <thead><tr><th>When</th><th>Service</th><th>Team</th><th>Price</th><th>Status</th><th>Payment</th></tr></thead>
  <tbody>${history.map((b) => html`<tr>
    <td><a href="/dashboard/bookings/${b.id}">${fmtDate(b.starts_at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}, ${fmtTime(b.starts_at.slice(11))}</a></td>
    <td>${b.service_name}</td><td>${b.staff_name}</td><td>${formatNaira(b.price_kobo)}</td><td>${statusBadge(b.status)}</td><td>${paymentBadge(b)}</td></tr>`)}</tbody>
</table></div>`,
    }));
  });

  // ---- Settings ----
  r.get('/dashboard/settings', (req, res) => {
    const b = req.business;
    const hours = JSON.parse(b.hours);
    res.send(ownerPage(req, {
      title: 'Settings',
      active: 'settings',
      body: html`<form method="post" action="/dashboard/settings" class="settings-grid">
  <section class="card form">
    <h2>Business profile</h2>
    <label>Business name<input name="name" required value="${b.name}"></label>
    <div class="two">
      <label>Category<select name="category">${CATEGORIES.map((c) => html`<option ${c === b.category ? 'selected' : ''}>${c}</option>`)}</select></label>
      <label>City<select name="city">${CITIES.map((c) => html`<option ${c === b.city ? 'selected' : ''}>${c}</option>`)}</select></label>
    </div>
    <label>Street address<input name="address" value="${b.address}"></label>
    <label>Area / neighbourhood<input name="area" value="${b.area}"></label>
    <div class="two">
      <label>Phone<input name="phone" type="tel" value="${displayPhone(b.phone)}"></label>
      <label>WhatsApp<input name="whatsapp" type="tel" value="${displayPhone(b.whatsapp)}"></label>
    </div>
    <label>About your business<textarea name="description" rows="3" maxlength="600">${b.description}</textarea></label>
    <p class="small">Your booking link: <a href="/b/${b.slug}" target="_blank" rel="noopener">${cfg.baseUrl}/b/${b.slug}</a></p>
  </section>
  <section class="card form">
    <h2>Opening hours</h2>
    <table class="hours-edit">
      ${DAYS.map(([key, label]) => html`<tr>
        <td><label class="check"><input type="checkbox" name="${key}_open" value="1" ${hours[key] ? 'checked' : ''}> ${label}</label></td>
        <td><input type="time" name="${key}_from" value="${hours[key]?.open || '09:00'}" aria-label="${label} opening time"></td>
        <td><input type="time" name="${key}_to" value="${hours[key]?.close || '18:00'}" aria-label="${label} closing time"></td></tr>`)}
    </table>
    <label>Time slot interval<select name="slot_minutes">${[15, 30, 60].map((m) => html`<option value="${m}" ${m === b.slot_minutes ? 'selected' : ''}>Every ${m} minutes</option>`)}</select></label>
    <p class="muted small">All times are West Africa Time (WAT).</p>
  </section>
  <div class="actions"><button class="btn btn-lg">Save settings</button></div>
</form>`,
    }));
  });

  r.post('/dashboard/settings', (req, res) => {
    const v = req.body;
    const name = String(v.name || '').trim();
    if (!name) return done(res, '/dashboard/settings', 'Business name is required.');
    const hours = {};
    for (const [key] of DAYS) {
      const from = v[`${key}_from`];
      const to = v[`${key}_to`];
      hours[key] = v[`${key}_open`] && isTime(from) && isTime(to) && toMin(to) > toMin(from) ? { open: from, close: to } : null;
    }
    const b = req.business;
    db.prepare(`UPDATE businesses SET name = ?, category = ?, city = ?, address = ?, area = ?, phone = ?, whatsapp = ?, description = ?,
      hours = ?, slot_minutes = ? WHERE id = ?`).run(
      name,
      CATEGORIES.includes(v.category) ? v.category : b.category,
      CITIES.includes(v.city) ? v.city : b.city,
      String(v.address || '').trim(), String(v.area || '').trim(),
      normalizePhone(v.phone) || b.phone, normalizePhone(v.whatsapp) || '',
      String(v.description || '').trim(), JSON.stringify(hours),
      [15, 30, 60].includes(Number(v.slot_minutes)) ? Number(v.slot_minutes) : b.slot_minutes,
      b.id,
    );
    done(res, '/dashboard/settings', 'Settings saved');
  });

  return r;
}
