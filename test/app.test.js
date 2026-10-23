import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createPaystack } from '../src/paystack.js';
import { seedDemo } from '../src/seed-data.js';
import { addDays } from '../src/util.js';

const NOW = '2026-10-23 08:00'; // a Friday
const SECRET = 'sk_test_fake';

async function setup() {
  const db = openDb(':memory:');
  seedDemo(db, { now: NOW, pastDays: 20, futureDays: 0 });
  const app = createApp({
    db,
    config: { sessionSecret: 'test', baseUrl: 'http://test', now: () => NOW, paystack: createPaystack({ secretKey: SECRET, fetchImpl: async () => { throw new Error('no network'); } }) },
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (path, opts = {}) => fetch(base + path, { redirect: 'manual', ...opts });
  const post = (path, body, headers = {}) => req(path, {
    method: 'POST', body: new URLSearchParams(body), headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
  return { db, server, req, post };
}

test('customer books a slot, and the same slot cannot be double booked', async (t) => {
  const { db, server, req, post } = await setup();
  t.after(() => server.close());
  const biz = db.prepare("SELECT * FROM businesses WHERE slug = 'glow-lounge-lekki'").get();
  const service = db.prepare('SELECT * FROM services WHERE business_id = ? LIMIT 1').get(biz.id);
  const staff = db.prepare('SELECT * FROM staff WHERE business_id = ? LIMIT 1').get(biz.id);
  const date = addDays(NOW.slice(0, 10), 1); // Saturday, opens 10:00

  assert.equal((await req('/b/glow-lounge-lekki')).status, 200);
  const page = await (await req(`/b/glow-lounge-lekki/book?service=${service.id}&staff=${staff.id}&date=${date}`)).text();
  assert.match(page, /10:00am/);

  const body = { service: service.id, staff: staff.id, date, time: '10:00', name: 'Temi Ade', phone: '0809 555 1234' };
  const first = await post('/b/glow-lounge-lekki/book', body);
  assert.equal(first.status, 303);
  const ref = first.headers.get('location').match(/\/booking\/(BK\w+)/)[1];
  const booking = db.prepare('SELECT * FROM bookings WHERE ref = ?').get(ref);
  assert.equal(booking.starts_at, `${date} 10:00`);
  assert.equal(booking.price_kobo, service.price_kobo);
  assert.equal(db.prepare('SELECT phone FROM customers WHERE id = ?').get(booking.customer_id).phone, '+2348095551234');

  const second = await post('/b/glow-lounge-lekki/book', { ...body, name: 'Someone Else', phone: '08030000000' });
  assert.equal(second.status, 422);
  assert.match(await second.text(), /just taken/);

  const confirmation = await (await req(`/booking/${ref}`)).text();
  assert.match(confirmation, /Temi Ade|Swedish massage|Confirmed/);

  const cancel = await post(`/booking/${ref}/cancel`, {});
  assert.equal(cancel.status, 303);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE ref = ?').get(ref).status, 'cancelled');
});

test('owner logs in, sees revenue, and records a walk-in with payment', async (t) => {
  const { db, server, req, post } = await setup();
  t.after(() => server.close());
  assert.equal((await req('/dashboard')).status, 302);
  const bad = await post('/login', { email: 'demo@booknaija.ng', password: 'wrong' });
  assert.equal(bad.status, 401);
  const login = await post('/login', { email: 'demo@booknaija.ng', password: 'demo1234' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const auth = { headers: { cookie } };

  const dash = await (await req('/dashboard', auth)).text();
  assert.match(dash, /This month/);
  for (const path of ['/dashboard/calendar', '/dashboard/bookings', '/dashboard/customers', '/dashboard/services', '/dashboard/staff', '/dashboard/settings']) {
    assert.equal((await req(path, auth)).status, 200, path);
  }

  const biz = db.prepare("SELECT * FROM businesses WHERE slug = 'glow-lounge-lekki'").get();
  const service = db.prepare('SELECT * FROM services WHERE business_id = ? LIMIT 1').get(biz.id);
  const staff = db.prepare('SELECT * FROM staff WHERE business_id = ? LIMIT 1').get(biz.id);
  const res = await post('/dashboard/bookings', {
    service: service.id, staff: staff.id, date: '2026-10-23', time: '07:00', name: 'Walk In', phone: '08021112222', source: 'walk_in', paid: 'cash',
  }, { cookie });
  assert.equal(res.status, 303);
  const walkIn = db.prepare("SELECT * FROM bookings WHERE starts_at = '2026-10-23 07:00' AND business_id = ?").get(biz.id);
  assert.equal(walkIn.payment_status, 'paid');
  assert.equal(walkIn.payment_method, 'cash');

  // Owners cannot see another business's bookings.
  const other = db.prepare('SELECT id FROM bookings WHERE business_id <> ? LIMIT 1').get(biz.id);
  assert.equal((await req(`/dashboard/bookings/${other.id}`, auth)).status, 404);

  const csv = await (await req('/dashboard/bookings.csv?from=2026-10-01&to=2026-10-23', auth)).text();
  assert.match(csv.split('\n')[0], /^Ref,Date,Time,Client/);
});

test('signup creates a business with a public booking page', async (t) => {
  const { server, req, post } = await setup();
  t.after(() => server.close());
  const res = await post('/signup', {
    name: 'Ngozi Obi', email: 'ngozi@example.com', password: 'password123', business: 'Ngozi Hair Studio',
    category: 'Hair salon', city: 'Enugu', area: 'Independence Layout', phone: '08051234567',
  });
  assert.equal(res.status, 303);
  assert.equal((await req('/b/ngozi-hair-studio')).status, 200);
});

test('Paystack webhook marks a booking paid only with a valid signature', async (t) => {
  const { db, server, req } = await setup();
  t.after(() => server.close());
  const b = db.prepare("SELECT * FROM bookings WHERE payment_status = 'unpaid' LIMIT 1").get();
  db.prepare('UPDATE bookings SET paystack_ref = ? WHERE id = ?').run('ref-123', b.id);
  const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'ref-123', amount: b.price_kobo, currency: 'NGN' } });
  const send = (sig) => req('/paystack/webhook', { method: 'POST', body: payload, headers: { 'content-type': 'application/json', 'x-paystack-signature': sig } });

  assert.equal((await send('bad')).status, 401);
  assert.equal(db.prepare('SELECT payment_status FROM bookings WHERE id = ?').get(b.id).payment_status, 'unpaid');
  const sig = crypto.createHmac('sha512', SECRET).update(payload).digest('hex');
  assert.equal((await send(sig)).status, 200);
  assert.equal(db.prepare('SELECT payment_method FROM bookings WHERE id = ?').get(b.id).payment_method, 'paystack');
});
