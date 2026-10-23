import { createApp } from './app.js';
import { openDb } from './db.js';
import { seedDemo } from './seed-data.js';

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

const db = openDb();

// Fills an empty database with demo businesses so a fresh deploy has something to show.
if (process.env.SEED_DEMO === 'true' && !db.prepare('SELECT 1 FROM businesses LIMIT 1').get()) {
  const { businesses, bookings } = seedDemo(db);
  console.log(`Empty database: seeded ${businesses} demo businesses and ${bookings} bookings`);
}

const port = Number(process.env.PORT) || 3000;
createApp({ db }).listen(port, () => {
  console.log(`BookNaija running on http://localhost:${port}`);
});
