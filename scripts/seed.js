// Creates demo businesses with ~2 months of realistic bookings.
// Usage: npm run seed            (uses DATABASE_PATH or data/booknaija.db; wipes it first)
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed-data.js';

const file = process.env.DATABASE_PATH || 'data/booknaija.db';
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
const db = openDb(file);
const summary = seedDemo(db);
console.log(`Seeded ${summary.businesses} businesses and ${summary.bookings} bookings into ${file}`);
console.log('Owner login: demo@booknaija.ng / demo1234 (Glow Lounge Spa & Salon)');
