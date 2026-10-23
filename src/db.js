import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL,                 -- JSON: {"mon":{"open":"09:00","close":"18:00"}, "sun":null, ...}
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price_kobo INTEGER NOT NULL CHECK (price_kobo >= 0),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (business_id, phone)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  starts_at TEXT NOT NULL,             -- local WAT 'YYYY-MM-DD HH:MM'
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','completed','cancelled','no_show')),
  price_kobo INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  payment_method TEXT CHECK (payment_method IN ('cash','transfer','pos','paystack')),
  paid_at TEXT,
  paystack_ref TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online','walk_in','phone')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS bookings_business_start ON bookings (business_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_staff_start ON bookings (staff_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_customer ON bookings (customer_id);
`;

export function openDb(file = process.env.DATABASE_PATH || 'data/booknaija.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const DEFAULT_HOURS = {
  mon: { open: '09:00', close: '19:00' },
  tue: { open: '09:00', close: '19:00' },
  wed: { open: '09:00', close: '19:00' },
  thu: { open: '09:00', close: '19:00' },
  fri: { open: '09:00', close: '19:00' },
  sat: { open: '10:00', close: '18:00' },
  sun: null,
};

export const CATEGORIES = [
  'Hair salon', 'Barber', 'Spa', 'Nails', 'Makeup', 'Lashes & brows', 'Massage', 'Skin care', 'Fitness', 'Clinic',
];

export const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Benin City', 'Enugu', 'Kano', 'Abeokuta', 'Uyo', 'Owerri'];
