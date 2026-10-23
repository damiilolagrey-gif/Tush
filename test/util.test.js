import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, formatNaira, normalizePhone, parseNaira, weekStart } from '../src/util.js';
import { availableSlots } from '../src/booking.js';

test('normalizePhone accepts common Nigerian formats', () => {
  for (const input of ['08031234567', '0803 123 4567', '+234 803 123 4567', '2348031234567', '8031234567']) {
    assert.equal(normalizePhone(input), '+2348031234567', input);
  }
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('06031234567'), null);
});

test('naira formatting and parsing use kobo', () => {
  assert.equal(formatNaira(2500000), '₦25,000');
  assert.equal(formatNaira(150), '₦1.50');
  assert.equal(parseNaira('₦25,000'), 2500000);
  assert.equal(parseNaira('abc'), null);
});

test('date helpers', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(weekStart('2026-10-25'), '2026-10-19'); // Sunday belongs to the week starting Monday
});

const hours = { fri: { open: '09:00', close: '12:00' }, sat: null };

test('slots skip overlapping bookings per staff member', () => {
  const slots = availableSlots({
    hours, date: '2026-10-23', duration: 60, step: 30, staffIds: [1],
    bookings: [{ staff_id: 1, starts_at: '2026-10-23 10:00', ends_at: '2026-10-23 11:00' }], now: '2026-10-22 08:00',
  });
  assert.deepEqual(slots.map((s) => s.time), ['09:00', '11:00']);
});

test('any professional: a slot stays open while one staff member is free', () => {
  const slots = availableSlots({
    hours, date: '2026-10-23', duration: 60, step: 60, staffIds: [1, 2],
    bookings: [{ staff_id: 1, starts_at: '2026-10-23 09:00', ends_at: '2026-10-23 10:00' }], now: '2026-10-22 08:00',
  });
  assert.deepEqual(slots[0], { time: '09:00', staffIds: [2] });
});

test('slots respect closed days, the past and the lead time', () => {
  assert.equal(availableSlots({ hours, date: '2026-10-24', duration: 30, staffIds: [1], bookings: [], now: '2026-10-22 08:00' }).length, 0);
  assert.equal(availableSlots({ hours, date: '2026-10-22', duration: 30, staffIds: [1], bookings: [], now: '2026-10-23 08:00' }).length, 0);
  const today = availableSlots({ hours, date: '2026-10-23', duration: 30, staffIds: [1], bookings: [], now: '2026-10-23 10:10' });
  assert.equal(today[0].time, '11:00');
});
