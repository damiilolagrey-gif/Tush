import path from 'node:path';
import express from 'express';
import { clearSessionCookie, parseCookies, readSessionToken } from './auth.js';
import { createPaystack } from './paystack.js';
import { publicRoutes } from './routes/public.js';
import { ownerRoutes } from './routes/owner.js';
import { page, publicHeader, html } from './html.js';

export function createApp({ db, config = {} }) {
  const cfg = {
    sessionSecret: config.sessionSecret || process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    baseUrl: config.baseUrl || process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000',
    secureCookies: config.secureCookies ?? process.env.NODE_ENV === 'production',
    paystack: config.paystack || createPaystack({ secretKey: process.env.PAYSTACK_SECRET_KEY }),
    now: config.now, // injectable clock for tests
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  // Webhook needs the raw body for signature verification, so it goes before body parsing.
  app.post('/paystack/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    if (!cfg.paystack.verifyWebhook(req.body, req.get('x-paystack-signature'))) return res.sendStatus(401);
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success' && event.data?.currency === 'NGN') {
      const booking = db.prepare('SELECT * FROM bookings WHERE paystack_ref = ?').get(event.data.reference);
      if (booking && event.data.amount >= booking.price_kobo) {
        db.prepare(`UPDATE bookings SET payment_status = 'paid', payment_method = 'paystack', paid_at = datetime('now')
          WHERE id = ? AND payment_status = 'unpaid'`).run(booking.id);
      }
    }
    res.sendStatus(200);
  });

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.static(path.join(import.meta.dirname, '..', 'public'), { maxAge: '1h' }));

  app.use((req, res, next) => {
    const userId = readSessionToken(parseCookies(req.headers.cookie).sid, cfg.sessionSecret);
    req.user = userId ? db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId) : null;
    if (req.user) req.business = db.prepare('SELECT * FROM businesses WHERE owner_id = ?').get(req.user.id);
    else if (parseCookies(req.headers.cookie).sid) res.append('Set-Cookie', clearSessionCookie);
    next();
  });

  app.use(publicRoutes({ db, cfg }));
  app.use(ownerRoutes({ db, cfg }));

  app.use((req, res) => {
    res.status(404).send(page({
      title: 'Not found',
      body: html`${publicHeader(req.user)}<main class="container narrow empty">
        <h1>Page not found</h1><p>The page you are looking for does not exist.</p><a class="btn" href="/">Go home</a></main>`,
    }));
  });

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).send(page({
      title: 'Error',
      body: html`${publicHeader(req.user)}<main class="container narrow empty">
        <h1>Something went wrong</h1><p>Please try again in a moment.</p><a class="btn" href="/">Go home</a></main>`,
    }));
  });

  return app;
}
