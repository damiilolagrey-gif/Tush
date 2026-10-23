import { transaction } from './db.js';
import { fromMin, makeRef, normalizePhone, nowWAT, toMin, weekday } from './util.js';

export class BookingError extends Error {}

/**
 * Start times on `date` at which a service of `duration` minutes fits, and which
 * staff are free for each. Bookings are [{staff_id, starts_at, ends_at}] for that date.
 */
export function availableSlots({ hours, date, duration, step = 30, staffIds, bookings, now = nowWAT(), leadMin = 30 }) {
  const day = hours[weekday(date)];
  if (!day || !staffIds.length) return [];
  const open = toMin(day.open);
  const close = toMin(day.close);
  const today = now.slice(0, 10);
  if (date < today) return [];
  const earliest = date === today ? toMin(now.slice(11)) + leadMin : -1;

  const busy = new Map(staffIds.map((id) => [id, []]));
  for (const b of bookings) {
    busy.get(b.staff_id)?.push([toMin(b.starts_at.slice(11)), toMin(b.ends_at.slice(11))]);
  }

  const slots = [];
  for (let start = open; start + duration <= close; start += step) {
    if (start < earliest) continue;
    const end = start + duration;
    const free = staffIds.filter((id) => busy.get(id).every(([s, e]) => end <= s || start >= e));
    if (free.length) slots.push({ time: fromMin(start), staffIds: free });
  }
  return slots;
}

export function activeStaff(db, businessId) {
  return db.prepare('SELECT * FROM staff WHERE business_id = ? AND active = 1 ORDER BY id').all(businessId);
}

export function bookingsOnDate(db, businessId, date) {
  return db.prepare(`SELECT staff_id, starts_at, ends_at FROM bookings
    WHERE business_id = ? AND substr(starts_at, 1, 10) = ? AND status IN ('confirmed', 'completed')`).all(businessId, date);
}

export function slotsFor(db, business, service, date, staffId, now) {
  const staff = activeStaff(db, business.id).map((s) => s.id);
  const staffIds = staffId ? staff.filter((id) => id === staffId) : staff;
  return availableSlots({
    hours: JSON.parse(business.hours),
    date,
    duration: service.duration_min,
    step: business.slot_minutes,
    staffIds,
    bookings: bookingsOnDate(db, business.id, date),
    now,
  });
}

export function upsertCustomer(db, businessId, { name, phone, email = '' }) {
  const existing = db.prepare('SELECT * FROM customers WHERE business_id = ? AND phone = ?').get(businessId, phone);
  if (existing) {
    db.prepare('UPDATE customers SET name = ?, email = CASE WHEN ? <> \'\' THEN ? ELSE email END WHERE id = ?')
      .run(name, email, email, existing.id);
    return existing.id;
  }
  return Number(db.prepare('INSERT INTO customers (business_id, name, phone, email) VALUES (?, ?, ?, ?)')
    .run(businessId, name, phone, email).lastInsertRowid);
}

/**
 * Creates a booking after re-checking availability inside a write transaction,
 * so two customers can never take the same staff member's time.
 * `ignoreHours` lets the owner add walk-ins outside the published slots.
 */
export function createBooking(db, business, input, { ignoreHours = false, now } = {}) {
  const name = String(input.name || '').trim();
  const phone = normalizePhone(input.phone);
  const email = String(input.email || '').trim().toLowerCase();
  if (!name) throw new BookingError('Please enter your name.');
  if (!phone) throw new BookingError('Please enter a valid Nigerian phone number, e.g. 0803 123 4567.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BookingError('That email address does not look right.');

  const service = db.prepare('SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1')
    .get(Number(input.serviceId), business.id);
  if (!service) throw new BookingError('That service is no longer available.');
  const staffId = input.staffId ? Number(input.staffId) : null;
  if (staffId && !activeStaff(db, business.id).some((s) => s.id === staffId)) {
    throw new BookingError('That team member is not available.');
  }

  return transaction(db, () => {
    let chosenStaff;
    if (ignoreHours) {
      chosenStaff = staffId;
      const start = toMin(input.time);
      const clash = bookingsOnDate(db, business.id, input.date).some((b) => b.staff_id === staffId
        && start < toMin(b.ends_at.slice(11)) && start + service.duration_min > toMin(b.starts_at.slice(11)));
      if (!chosenStaff || clash) throw new BookingError('That team member already has a booking at this time.');
      if (start + service.duration_min > 24 * 60) throw new BookingError('Bookings must finish on the same day.');
    } else {
      const slot = slotsFor(db, business, service, input.date, staffId, now).find((s) => s.time === input.time);
      if (!slot) throw new BookingError('Sorry, that time was just taken. Please pick another slot.');
      chosenStaff = slot.staffIds[0];
    }

    const customerId = upsertCustomer(db, business.id, { name, phone, email });
    const ref = makeRef();
    const startsAt = `${input.date} ${input.time}`;
    const endsAt = `${input.date} ${fromMin(toMin(input.time) + service.duration_min)}`;
    db.prepare(`INSERT INTO bookings (ref, business_id, customer_id, service_id, staff_id, starts_at, ends_at, price_kobo, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ref, business.id, customerId, service.id, chosenStaff, startsAt, endsAt, service.price_kobo,
        input.source || 'online', String(input.notes || '').slice(0, 500));
    return ref;
  });
}

export function bookingByRef(db, ref) {
  return db.prepare(`SELECT b.*, s.name AS service_name, s.duration_min, st.name AS staff_name,
      c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
      biz.name AS business_name, biz.slug AS business_slug, biz.address, biz.area, biz.city,
      biz.phone AS business_phone, biz.whatsapp AS business_whatsapp
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    JOIN staff st ON st.id = b.staff_id
    JOIN customers c ON c.id = b.customer_id
    JOIN businesses biz ON biz.id = b.business_id
    WHERE b.ref = ?`).get(ref);
}

export function markPaid(db, bookingId, method) {
  db.prepare(`UPDATE bookings SET payment_status = 'paid', payment_method = ?, paid_at = datetime('now')
    WHERE id = ? AND payment_status = 'unpaid'`).run(method, bookingId);
}
