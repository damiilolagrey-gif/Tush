import { addDays, monthStart, prevMonthStart, weekStart } from './util.js';

// Revenue is counted on the appointment date, from bookings marked paid.
// "Outstanding" is completed work that has not been paid for yet.
export function dashboardStats(db, businessId, today) {
  const sum = (from, to) => db.prepare(`SELECT COALESCE(SUM(price_kobo), 0) AS total, COUNT(*) AS n FROM bookings
    WHERE business_id = ? AND payment_status = 'paid' AND substr(starts_at, 1, 10) BETWEEN ? AND ?`).get(businessId, from, to);

  const mStart = monthStart(today);
  const pmStart = prevMonthStart(today);
  // Same number of days into last month, for a fair month-to-date comparison.
  const dayOfMonth = Number(today.slice(8));
  const pmSameDay = addDays(pmStart, Math.min(dayOfMonth, 31) - 1);
  const pmEnd = addDays(mStart, -1);

  const revenue = {
    today: sum(today, today).total,
    week: sum(weekStart(today), today).total,
    month: sum(mStart, today).total,
    lastMonthToDate: sum(pmStart, pmSameDay < pmEnd ? pmSameDay : pmEnd).total,
  };

  const outstanding = db.prepare(`SELECT COALESCE(SUM(price_kobo), 0) AS total, COUNT(*) AS n FROM bookings
    WHERE business_id = ? AND status = 'completed' AND payment_status = 'unpaid'`).get(businessId);

  const statusCounts = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS n FROM bookings
    WHERE business_id = ? AND substr(starts_at, 1, 10) BETWEEN ? AND ? GROUP BY status`).all(businessId, mStart, today)
    .map((r) => [r.status, r.n]));
  const monthBookings = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const upcomingCount = db.prepare(`SELECT COUNT(*) AS n FROM bookings
    WHERE business_id = ? AND status = 'confirmed' AND substr(starts_at, 1, 10) > ?`).get(businessId, today).n;

  const paidThisMonth = sum(mStart, today);
  const avgTicket = paidThisMonth.n ? Math.round(paidThisMonth.total / paidThisMonth.n / 100) * 100 : 0;

  const from30 = addDays(today, -29);
  const byDay = new Map(db.prepare(`SELECT substr(starts_at, 1, 10) AS day, SUM(price_kobo) AS total FROM bookings
    WHERE business_id = ? AND payment_status = 'paid' AND substr(starts_at, 1, 10) BETWEEN ? AND ? GROUP BY day`)
    .all(businessId, from30, today).map((r) => [r.day, r.total]));
  const daily = Array.from({ length: 30 }, (_, i) => {
    const day = addDays(from30, i);
    return { day, total: byDay.get(day) || 0 };
  });

  const topServices = db.prepare(`SELECT s.name, COUNT(*) AS n, SUM(CASE WHEN b.payment_status = 'paid' THEN b.price_kobo ELSE 0 END) AS revenue
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.business_id = ? AND b.status IN ('confirmed', 'completed') AND substr(b.starts_at, 1, 10) BETWEEN ? AND ?
    GROUP BY s.id ORDER BY revenue DESC, n DESC LIMIT 5`).all(businessId, mStart, today);

  const staffPerformance = db.prepare(`SELECT st.name, COUNT(*) AS n, SUM(CASE WHEN b.payment_status = 'paid' THEN b.price_kobo ELSE 0 END) AS revenue
    FROM bookings b JOIN staff st ON st.id = b.staff_id
    WHERE b.business_id = ? AND b.status IN ('confirmed', 'completed') AND substr(b.starts_at, 1, 10) BETWEEN ? AND ?
    GROUP BY st.id ORDER BY revenue DESC`).all(businessId, mStart, today);

  const paymentMix = db.prepare(`SELECT payment_method AS method, SUM(price_kobo) AS total FROM bookings
    WHERE business_id = ? AND payment_status = 'paid' AND substr(starts_at, 1, 10) BETWEEN ? AND ?
    GROUP BY payment_method ORDER BY total DESC`).all(businessId, mStart, today);

  // A customer is "returning" this month if they had a booking before the month started.
  const customers = db.prepare(`SELECT
      COUNT(DISTINCT b.customer_id) AS total,
      COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM bookings p WHERE p.customer_id = b.customer_id
        AND p.status <> 'cancelled' AND substr(p.starts_at, 1, 10) < ?) THEN b.customer_id END) AS returning_count
    FROM bookings b WHERE b.business_id = ? AND b.status <> 'cancelled' AND substr(b.starts_at, 1, 10) BETWEEN ? AND ?`)
    .get(mStart, businessId, mStart, today);

  return {
    revenue, outstanding, statusCounts, monthBookings, upcomingCount, avgTicket, daily,
    topServices, staffPerformance, paymentMix, customers,
  };
}

export const BOOKING_SELECT = `SELECT b.*, s.name AS service_name, s.duration_min, st.name AS staff_name,
    c.name AS customer_name, c.phone AS customer_phone
  FROM bookings b
  JOIN services s ON s.id = b.service_id
  JOIN staff st ON st.id = b.staff_id
  JOIN customers c ON c.id = b.customer_id`;
