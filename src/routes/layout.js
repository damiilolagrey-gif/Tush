import { APP_NAME, html, page } from '../html.js';
import { fmtDate, fmtTime } from '../util.js';

export const STATUS_LABEL = { confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' };

const NAV = [
  ['overview', '/dashboard', 'Overview', '📊'],
  ['calendar', '/dashboard/calendar', 'Calendar', '🗓️'],
  ['bookings', '/dashboard/bookings', 'Bookings', '📋'],
  ['customers', '/dashboard/customers', 'Customers', '👥'],
  ['services', '/dashboard/services', 'Services', '✂️'],
  ['staff', '/dashboard/staff', 'Team', '🧑🏾‍💼'],
  ['settings', '/dashboard/settings', 'Settings', '⚙️'],
];

export function ownerPage(req, { title, active, body, actions = '', error }) {
  const biz = req.business;
  return page({
    title,
    bodyClass: 'owner',
    flash: typeof req.query.ok === 'string' ? req.query.ok : '',
    error,
    body: html`<div class="owner-shell">
  <aside class="sidebar">
    <a class="brand" href="/dashboard"><span class="logo">B</span>${APP_NAME}</a>
    <div class="biz-name">${biz.name}</div>
    <nav>
      ${NAV.map(([key, href, label, icon]) => html`<a href="${href}" class="${key === active ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${label}</a>`)}
    </nav>
    <div class="sidebar-foot">
      <a href="/b/${biz.slug}" target="_blank" rel="noopener">View booking page ↗</a>
      <form method="post" action="/logout"><button class="link">Log out</button></form>
    </div>
  </aside>
  <main class="owner-main">
    <div class="page-head">
      <h1>${title}</h1>
      <div class="actions">${actions}</div>
    </div>
    ${body}
  </main>
</div>`,
  });
}

// Redirect after a POST, carrying a short confirmation message.
export function done(res, url, message) {
  const sep = url.includes('?') ? '&' : '?';
  res.redirect(303, message ? `${url}${sep}ok=${encodeURIComponent(message)}` : url);
}

export const PAYMENT_LABEL = { cash: 'Cash', transfer: 'Bank transfer', pos: 'POS', paystack: 'Paystack' };

export function statusBadge(status) {
  return html`<span class="badge badge-${status}">${STATUS_LABEL[status]}</span>`;
}

export function paymentBadge(b) {
  return b.payment_status === 'paid'
    ? html`<span class="badge badge-completed">Paid · ${PAYMENT_LABEL[b.payment_method] || ''}</span>`
    : html`<span class="badge badge-pending">Unpaid</span>`;
}

export function reminderText(b, bizName) {
  return `Hello ${b.customer_name.split(' ')[0]}, this is ${bizName}. Reminder of your ${b.service_name} appointment on ${fmtDate(b.starts_at.slice(0, 10))} at ${fmtTime(b.starts_at.slice(11))} with ${b.staff_name}. Ref: ${b.ref}. Reply to reschedule. See you soon!`;
}
