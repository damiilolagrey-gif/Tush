import { createApp } from './app.js';
import { openDb } from './db.js';

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

const db = openDb();
const port = Number(process.env.PORT) || 3000;
createApp({ db }).listen(port, () => {
  console.log(`BookNaija running on http://localhost:${port}`);
});
