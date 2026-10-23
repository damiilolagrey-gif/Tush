import { Router } from 'express';
import { APP_NAME, html, page, publicHeader } from '../html.js';
import { CATEGORIES, CITIES } from '../db.js';
import { STATUS_LABEL } from './layout.js';
import { activeStaff, BookingError, bookingByRef, createBooking, markPaid, slotsFor } from '../booking.js';
import {
  addDays, displayPhone, fmtDate, fmtDuration, fmtTime, formatNaira, isDate, isTime, nowWAT, toMin, waLink, weekday,
} from '../util.js';

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export const categoryEmoji = (c) => ({
  'Hair salon': '💇🏾‍♀️', Barber: '💈', Spa: '🧖🏾‍♀️', Nails: '💅🏾', Makeup: '💄', 'Lashes & brows': '👁️',
  Massage: '💆🏾', 'Skin care': '✨', Fitness: '🏋🏾', Clinic: '🩺',
}[c] || '📅');

function cover(biz, cls = '') {
  const hue = [...biz.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  return html`<div class="cover ${cls}" style="--hue:${hue}"><span>${categoryEmoji(biz.category)}</span></div>`;
}

// Google Calendar wants UTC; WAT is UTC+1.
function gcalLink(b) {
  const utc = (s) => new Date(`${s.replace(' ', 'T')}:00+01:00`).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${b.service_name} at ${b.business_name}`,
    dates: `${utc(b.starts_at)}/${utc(b.ends_at)}`,
    details: `Booking ref ${b.ref} with ${b.staff_name}`,
    location: [b.address, b.area, b.city].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function publicRoutes({ db, cfg }) {
  const r = Router();
  const now = () => cfg.now?.() ?? nowWAT();

  const businessBySlug = (slug) => db.prepare('SELECT * FROM businesses WHERE slug = ?').get(slug);

  r.get('/', (req, res) => {
    const q = String(req.query.q || '').trim();
    const city = CITIES.includes(req.query.city) ? req.query.city : '';
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : '';
    const businesses = db.prepare(`SELECT b.*, MIN(s.price_kobo) AS min_price, COUNT(s.id) AS service_count
      FROM businesses b JOIN services s ON s.business_id = b.id AND s.active = 1
      WHERE (:city = '' OR b.city = :city) AND (:category = '' OR b.category = :category)
        AND (:q = '' OR b.name LIKE :like OR b.area LIKE :like OR s.name LIKE :like)
      GROUP BY b.id ORDER BY b.name`).all({ city, category, q, like: `%${q}%` });

    const filterUrl = (cat) => `/?${new URLSearchParams({ ...(q && { q }), ...(city && { city }), ...(cat && { category: cat }) })}`;

    res.send(page({
      user: req.user,
      body: html`${publicHeader(req.user)}
<section class="hero">
  <div class="container">
    <h1>Book beauty &amp; wellness <span class="accent">near you</span></h1>
    <p class="lead">Salons, barbers, spas and more across Nigeria. Pick a time, get confirmed instantly, pay at the venue or online.</p>
    <form class="search" action="/" method="get">
      <input name="q" value="${q}" placeholder="Search a service or business, e.g. braids" aria-label="Search">
      <select name="city" aria-label="City">
        <option value="">All cities</option>
        ${CITIES.map((c) => html`<option ${c === city ? 'selected' : ''}>${c}</option>`)}
      </select>
      ${category ? html`<input type="hidden" name="category" value="${category}">` : ''}
      <button class="btn">Search</button>
    </form>
  </div>
</section>
<main class="container">
  <div class="chips">
    <a class="chip ${category ? '' : 'active'}" href="${filterUrl('')}">All</a>
    ${CATEGORIES.map((c) => html`<a class="chip ${c === category ? 'active' : ''}" href="${filterUrl(c)}">${categoryEmoji(c)} ${c}</a>`)}
  </div>
  ${businesses.length ? html`<div class="grid cards">
    ${businesses.map((b) => html`<a class="card biz-card" href="/b/${b.slug}">
      ${cover(b)}
      <div class="card-body">
        <h3>${b.name}</h3>
        <p class="muted">${b.category} · ${[b.area, b.city].filter(Boolean).join(', ')}</p>
        <p class="small">${b.service_count} services · from <strong>${formatNaira(b.min_price)}</strong></p>
      </div>
    </a>`)}
  </div>` : html`<div class="empty"><h2>No businesses found</h2><p>Try another city or category.</p></div>`}

  <section class="owner-cta card">
    <div>
      <h2>Own a salon, barbershop or spa?</h2>
      <p>Take bookings 24/7, stop double bookings, track every naira and send WhatsApp reminders. Free to start.</p>
    </div>
    <a class="btn btn-lg" href="/signup">List your business</a>
  </section>
</main>
<footer class="site-footer container">Made for Nigerian businesses · Prices in Naira · Times in WAT</footer>`,
    }));
  });

  r.get('/b/:slug', (req, res, next) => {
    const biz = businessBySlug(req.params.slug);
    if (!biz) return next();
    const services = db.prepare('SELECT * FROM services WHERE business_id = ? AND active = 1 ORDER BY price_kobo').all(biz.id);
    const staff = activeStaff(db, biz.id);
    const hours = JSON.parse(biz.hours);
    const today = weekday(now().slice(0, 10));
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([biz.name, biz.address, biz.area, biz.city].filter(Boolean).join(', '))}`;

    res.send(page({
      title: biz.name,
      user: req.user,
      body: html`${publicHeader(req.user)}
<main class="container">
  ${cover(biz, 'cover-lg')}
  <div class="biz-head">
    <div>
      <h1>${biz.name}</h1>
      <p class="muted">${biz.category} · <a href="${mapUrl}" target="_blank" rel="noopener">${[biz.address, biz.area, biz.city].filter(Boolean).join(', ')}</a></p>
    </div>
    <div class="actions">
      <a class="btn btn-lg" href="/b/${biz.slug}/book">Book now</a>
      ${biz.whatsapp ? html`<a class="btn btn-wa" href="${waLink(biz.whatsapp, `Hi ${biz.name}, I found you on ${APP_NAME}.`)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${biz.phone ? html`<a class="btn btn-ghost" href="tel:${biz.phone}">Call</a>` : ''}
    </div>
  </div>
  <div class="biz-layout">
    <section>
      ${biz.description ? html`<p class="lead">${biz.description}</p>` : ''}
      <h2>Services</h2>
      <ul class="service-list">
        ${services.map((s) => html`<li>
          <div><strong>${s.name}</strong><span class="muted small">${fmtDuration(s.duration_min)}${s.description ? ` · ${s.description}` : ''}</span></div>
          <div class="service-price"><strong>${formatNaira(s.price_kobo)}</strong><a class="btn btn-sm btn-ghost" href="/b/${biz.slug}/book?service=${s.id}">Book</a></div>
        </li>`)}
      </ul>
      <h2>Team</h2>
      <div class="team">
        ${staff.map((s) => html`<div class="member"><span class="avatar">${s.name[0]}</span><strong>${s.name}</strong><span class="muted small">${s.role}</span></div>`)}
      </div>
    </section>
    <aside class="card">
      <h3>Opening hours</h3>
      <table class="hours">
        ${Object.keys(DAY_NAMES).map((d) => html`<tr class="${d === today ? 'today' : ''}">
          <td>${DAY_NAMES[d]}</td><td>${hours[d] ? `${fmtTime(hours[d].open)} – ${fmtTime(hours[d].close)}` : 'Closed'}</td></tr>`)}
      </table>
      ${biz.phone ? html`<p class="small">📞 <a href="tel:${biz.phone}">${displayPhone(biz.phone)}</a></p>` : ''}
    </aside>
  </div>
</main>`,
    }));
  });

  r.get('/b/:slug/book', (req, res, next) => {
    const biz = businessBySlug(req.params.slug);
    if (!biz) return next();
    const services = db.prepare('SELECT * FROM services WHERE business_id = ? AND active = 1 ORDER BY price_kobo').all(biz.id);
    const service = services.find((s) => s.id === Number(req.query.service));
    const back = html`<a class="back" href="/b/${biz.slug}">← ${biz.name}</a>`;

    if (!service) {
      return res.send(page({
        title: `Book at ${biz.name}`,
        user: req.user,
        body: html`${publicHeader(req.user)}<main class="container narrow">${back}
          <ol class="steps"><li class="active">Service</li><li>Time</li><li>Details</li></ol>
          <h1>Choose a service</h1>
          <div class="pick-list">${services.map((s) => html`<a class="pick" href="?service=${s.id}">
            <span><strong>${s.name}</strong><span class="muted small">${fmtDuration(s.duration_min)}</span></span>
            <strong>${formatNaira(s.price_kobo)}</strong></a>`)}</div></main>`,
      }));
    }

    const staff = activeStaff(db, biz.id);
    const staffId = staff.some((s) => s.id === Number(req.query.staff)) ? Number(req.query.staff) : null;
    const today = now().slice(0, 10);
    const hours = JSON.parse(biz.hours);
    const days = Array.from({ length: 21 }, (_, i) => addDays(today, i));
    let date = isDate(req.query.date) && days.includes(req.query.date) ? req.query.date : null;
    if (!date) date = days.find((d) => slotsFor(db, biz, service, d, staffId, now()).length) || today;
    const slots = slotsFor(db, biz, service, date, staffId, now());
    const link = (p) => `?${new URLSearchParams({ service: service.id, ...(staffId && { staff: staffId }), date, ...p })}`;
    const groups = [
      ['Morning', slots.filter((s) => toMin(s.time) < 12 * 60)],
      ['Afternoon', slots.filter((s) => toMin(s.time) >= 12 * 60 && toMin(s.time) < 17 * 60)],
      ['Evening', slots.filter((s) => toMin(s.time) >= 17 * 60)],
    ].filter(([, list]) => list.length);

    res.send(page({
      title: `Book ${service.name}`,
      user: req.user,
      body: html`${publicHeader(req.user)}<main class="container narrow">${back}
  <ol class="steps"><li class="done">Service</li><li class="active">Time</li><li>Details</li></ol>
  <div class="summary card">
    <div><strong>${service.name}</strong><span class="muted small">${fmtDuration(service.duration_min)} · ${formatNaira(service.price_kobo)}</span></div>
    <a class="small" href="?">Change</a>
  </div>
  <h2>Who would you like?</h2>
  <div class="chips">
    <a class="chip ${staffId ? '' : 'active'}" href="${link({ staff: '' })}">Any professional</a>
    ${staff.map((s) => html`<a class="chip ${s.id === staffId ? 'active' : ''}" href="?${new URLSearchParams({ service: service.id, staff: s.id, date })}">${s.name}</a>`)}
  </div>
  <h2>Pick a date</h2>
  <div class="date-strip" data-scroll-active>
    ${days.map((d) => {
      const closed = !hours[weekday(d)];
      return html`<a class="date ${d === date ? 'active' : ''} ${closed ? 'closed' : ''}" href="${link({ date: d })}">
        <span>${fmtDate(d, { weekday: 'short' })}</span><strong>${fmtDate(d, { day: 'numeric' })}</strong><span>${fmtDate(d, { month: 'short' })}</span></a>`;
    })}
  </div>
  <h2>Available times · ${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
  ${groups.length ? groups.map(([label, list]) => html`<h3 class="slot-group">${label}</h3><div class="slots">
    ${list.map((s) => html`<a class="slot" href="/b/${biz.slug}/book/details${link({ time: s.time })}">${fmtTime(s.time)}</a>`)}</div>`)
    : html`<div class="empty card"><p>${hours[weekday(date)] ? 'Fully booked on this day.' : `${biz.name} is closed on this day.`} Try another date${staffId ? ' or any professional' : ''}.</p></div>`}
</main>`,
    }));
  });

  function renderDetails(req, res, biz, { error, values = {} } = {}) {
    const service = db.prepare('SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1').get(Number(values.service ?? req.query.service), biz.id);
    const date = values.date ?? req.query.date;
    const time = values.time ?? req.query.time;
    if (!service || !isDate(date) || !isTime(time)) return res.redirect(`/b/${biz.slug}/book`);
    const staffId = Number(values.staff ?? req.query.staff) || '';
    const staffName = staffId ? activeStaff(db, biz.id).find((s) => s.id === staffId)?.name : 'Any professional';

    res.status(error ? 422 : 200).send(page({
      title: 'Your details',
      user: req.user,
      error,
      body: html`${publicHeader(req.user)}<main class="container narrow">
  <a class="back" href="/b/${biz.slug}/book?${new URLSearchParams({ service: service.id, ...(staffId && { staff: staffId }), date })}">← Change time</a>
  <ol class="steps"><li class="done">Service</li><li class="done">Time</li><li class="active">Details</li></ol>
  <div class="summary card stack">
    <strong>${biz.name}</strong>
    <div class="row"><span>${service.name} with ${staffName}</span><strong>${formatNaira(service.price_kobo)}</strong></div>
    <div class="muted small">${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmtTime(time)} · ${fmtDuration(service.duration_min)}</div>
  </div>
  <form method="post" action="/b/${biz.slug}/book" class="form card">
    <input type="hidden" name="service" value="${service.id}">
    <input type="hidden" name="staff" value="${staffId}">
    <input type="hidden" name="date" value="${date}">
    <input type="hidden" name="time" value="${time}">
    <label>Full name<input name="name" required autocomplete="name" value="${values.name || ''}"></label>
    <label>Phone number (WhatsApp)<input name="phone" required type="tel" inputmode="tel" autocomplete="tel" placeholder="0803 123 4567" value="${values.phone || ''}"></label>
    <label>Email <span class="muted">(optional, for receipts)</span><input name="email" type="email" autocomplete="email" value="${values.email || ''}"></label>
    <label>Notes for ${biz.name} <span class="muted">(optional)</span><textarea name="notes" rows="2" maxlength="500">${values.notes || ''}</textarea></label>
    <button class="btn btn-lg btn-block">Confirm booking</button>
    <p class="muted small center">Pay at the venue${cfg.paystack.enabled ? ' or online with Paystack after booking' : ''}.</p>
  </form>
</main>`,
    }));
  }

  r.get('/b/:slug/book/details', (req, res, next) => {
    const biz = businessBySlug(req.params.slug);
    if (!biz) return next();
    renderDetails(req, res, biz);
  });

  r.post('/b/:slug/book', (req, res, next) => {
    const biz = businessBySlug(req.params.slug);
    if (!biz) return next();
    const b = req.body;
    if (!isDate(b.date) || !isTime(b.time)) return res.redirect(`/b/${biz.slug}/book`);
    try {
      const ref = createBooking(db, biz, {
        serviceId: b.service, staffId: b.staff, date: b.date, time: b.time,
        name: b.name, phone: b.phone, email: b.email, notes: b.notes, source: 'online',
      }, { now: now() });
      res.redirect(303, `/booking/${ref}?new=1`);
    } catch (err) {
      if (!(err instanceof BookingError)) throw err;
      renderDetails(req, res, biz, { error: err.message, values: b });
    }
  });

  r.get('/booking/:ref', (req, res, next) => {
    const b = bookingByRef(db, req.params.ref);
    if (!b) return next();
    const date = b.starts_at.slice(0, 10);
    const time = b.starts_at.slice(11);
    const upcoming = b.status === 'confirmed' && b.starts_at > now();
    const waText = `Hi ${b.business_name}, this is ${b.customer_name}. My booking ref is ${b.ref} for ${b.service_name} on ${fmtDate(date)} at ${fmtTime(time)}.`;

    res.send(page({
      title: `Booking ${b.ref}`,
      user: req.user,
      flash: req.query.paid ? 'Payment received. Thank you!' : req.query.cancelled ? 'Your booking has been cancelled.' : '',
      error: req.query.payerror ? 'We could not confirm that payment. If you were debited, contact the business with your booking ref.' : '',
      body: html`${publicHeader(req.user)}<main class="container narrow">
  ${req.query.new ? html`<div class="success-banner"><span>✓</span><div><h1>You're booked!</h1><p>We've saved your appointment. Keep your reference handy.</p></div></div>`
    : html`<h1>Your booking</h1>`}
  <div class="card stack">
    <div class="row"><span class="muted">Reference</span><strong class="mono">${b.ref}</strong></div>
    <div class="row"><span class="muted">Status</span><span class="badge badge-${b.status}">${STATUS_LABEL[b.status]}</span></div>
    <hr>
    <strong>${b.business_name}</strong>
    <span class="muted small">${[b.address, b.area, b.city].filter(Boolean).join(', ')}</span>
    <div class="row"><span>${b.service_name}</span><strong>${formatNaira(b.price_kobo)}</strong></div>
    <div class="muted">${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at ${fmtTime(time)} · ${fmtDuration(b.duration_min)}</div>
    <div class="muted">With ${b.staff_name}</div>
    <div class="row"><span class="muted">Payment</span><span class="badge ${b.payment_status === 'paid' ? 'badge-completed' : 'badge-pending'}">${b.payment_status === 'paid' ? 'Paid' : 'Pay at venue'}</span></div>
  </div>
  ${upcoming && b.payment_status === 'unpaid' && cfg.paystack.enabled ? html`<form class="card form" method="post" action="/booking/${b.ref}/pay">
    <h3>Pay now with Paystack</h3>
    <p class="muted small">Card, bank transfer or USSD. Paystack needs an email for your receipt.</p>
    <label>Email<input type="email" name="email" required value="${b.customer_email}"></label>
    <button class="btn btn-block">Pay ${formatNaira(b.price_kobo)}</button>
  </form>` : ''}
  <div class="actions stack-mobile">
    ${upcoming ? html`<a class="btn btn-ghost" href="${gcalLink(b)}" target="_blank" rel="noopener">Add to calendar</a>` : ''}
    ${b.business_whatsapp ? html`<a class="btn btn-wa" href="${waLink(b.business_whatsapp, waText)}" target="_blank" rel="noopener">Message on WhatsApp</a>` : ''}
    <a class="btn btn-ghost" href="/b/${b.business_slug}">Book again</a>
  </div>
  ${upcoming ? html`<form method="post" action="/booking/${b.ref}/cancel" data-confirm="Cancel this booking?">
    <button class="link-danger">Cancel booking</button></form>` : ''}
</main>`,
    }));
  });

  r.post('/booking/:ref/cancel', (req, res, next) => {
    const b = bookingByRef(db, req.params.ref);
    if (!b) return next();
    if (b.status === 'confirmed' && b.starts_at > now()) {
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
    }
    res.redirect(303, `/booking/${b.ref}?cancelled=1`);
  });

  r.post('/booking/:ref/pay', async (req, res, next) => {
    const b = bookingByRef(db, req.params.ref);
    if (!b || !cfg.paystack.enabled) return next();
    if (b.payment_status === 'paid' || b.status !== 'confirmed') return res.redirect(303, `/booking/${b.ref}`);
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect(303, `/booking/${b.ref}?payerror=1`);
    db.prepare('UPDATE customers SET email = ? WHERE id = ?').run(email, b.customer_id);
    const reference = `${b.ref}-${Date.now().toString(36)}`;
    db.prepare('UPDATE bookings SET paystack_ref = ? WHERE id = ?').run(reference, b.id);
    try {
      const url = await cfg.paystack.initialize({
        email, amountKobo: b.price_kobo, reference,
        callbackUrl: `${cfg.baseUrl}/paystack/callback`,
        metadata: { booking_ref: b.ref, business: b.business_name },
      });
      res.redirect(303, url);
    } catch (err) {
      console.error(err);
      res.redirect(303, `/booking/${b.ref}?payerror=1`);
    }
  });

  r.get('/paystack/callback', async (req, res, next) => {
    const reference = String(req.query.reference || '');
    const b = db.prepare('SELECT id, ref, price_kobo FROM bookings WHERE paystack_ref = ?').get(reference);
    if (!b || !cfg.paystack.enabled) return next();
    try {
      const result = await cfg.paystack.verify(reference);
      if (result.paid && result.amountKobo >= b.price_kobo) {
        markPaid(db, b.id, 'paystack');
        return res.redirect(303, `/booking/${b.ref}?paid=1`);
      }
    } catch (err) {
      console.error(err);
    }
    res.redirect(303, `/booking/${b.ref}?payerror=1`);
  });

  return r;
}

