# BookNaija

BookNaija is an appointment booking platform for Nigerian service businesses like salons, barbers, spas, nail bars and lash studios. It's modelled on Fresha.

**For customers:** you can search businesses by city and category, pick a service, a professional (or "any"), a date and an open time slot, and book with just a name and phone number. You get a booking reference, an add-to-calendar link and a WhatsApp link to the business. You can cancel online, and you can pay online with Paystack when it's turned on.

**For business owners:** you get a dashboard with these features:
- **Overview:** revenue for today, this week and this month (compared with the same days last month), unpaid completed work, average sale, returning-client rate, cancellation and no-show rate, a 30-day revenue chart, top services, team performance, payment mix (cash, transfer, POS, Paystack), today's schedule and upcoming bookings.
- **Calendar:** a day view with one column per team member.
- **Bookings:** filters, search and CSV export. You can add walk-in or phone bookings, mark a booking completed, no-show or cancelled, and record payments.
- **Customers:** visit history, total spend and no-shows. One tap opens a WhatsApp confirmation or reminder.
- **Services, Team and Settings:** prices, durations, opening hours and slot interval.

Nigerian defaults: prices are stored in kobo and shown in ₦. All times are in WAT (Africa/Lagos, UTC+1, no daylight saving). Phone numbers are normalised to `+234`. Contact happens over WhatsApp click-to-chat.

## Run it

You need Node.js 22.13 or newer. It uses the built-in `node:sqlite`, so there are no native modules.

```bash
npm install
npm run seed     # demo data: 5 businesses with about 2 months of bookings (wipes the DB)
npm start        # http://localhost:3000
npm test
```

Demo owner login: `demo@booknaija.ng` / `demo1234` (Glow Lounge Spa & Salon). The other demo owners are `kings@`, `bisi@`, `lash@` and `nails@booknaija.ng`, all with the same password.

## Configuration

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `DATABASE_PATH` | SQLite file (default `data/booknaija.db`). Put it on a persistent disk in production. |
| `SESSION_SECRET` | Required in production. A long random string for signing login cookies. |
| `BASE_URL` | Public URL, used in Paystack callbacks and shared links (defaults to Render's URL on Render) |
| `SEED_DEMO` | `true` seeds demo data into an empty database on startup |
| `PAYSTACK_SECRET_KEY` | Turns on "Pay now with Paystack". Without it, customers pay at the venue. |
| `APP_NAME` | Brand name shown in the UI |

For Paystack, set the webhook URL in your Paystack dashboard to `https://<your-domain>/paystack/webhook`. Payments are confirmed two ways: by the redirect callback and by the signed webhook.

## Deploy

**Render (recommended):** this repo includes a `render.yaml` blueprint.

1. In Render, click **New → Blueprint** and pick this repository.
2. Fill in `PAYSTACK_SECRET_KEY` when Render asks. You can leave it blank to start with pay-at-venue only.
3. Click **Apply**. Render builds the app and attaches a 1 GB disk for the database. It also generates `SESSION_SECRET` for you.

The blueprint uses the Starter plan, because persistent disks need a paid plan. On the free plan you would lose every booking whenever the app restarts. `SEED_DEMO=true` fills an empty database with the demo businesses. Set it to `false` and wipe the disk before onboarding real businesses. To use your own domain, add it under the service's **Settings → Custom Domains** and set `BASE_URL` to match.

**Other hosts:** any Node host with a persistent disk works, such as Railway, Fly.io, or a VPS running `npm start` under systemd or pm2 behind nginx. Set `DATABASE_PATH` to a file on the persistent volume.

## Code map

```
src/app.js          Express app, sessions, Paystack webhook
src/db.js           SQLite schema and constants (categories, cities, default hours)
src/booking.js      Slot availability and double-booking-safe booking creation
src/stats.js        Dashboard revenue and performance queries
src/paystack.js     Paystack initialize, verify and webhook signature check
src/routes/         public.js (marketplace and booking), owner.js (auth, dashboard, calendar, bookings), manage.js (services, team, customers, settings)
src/seed-data.js    Demo data generator
public/             CSS and a small progressive-enhancement script (pages work without JS)
```

## Next steps worth considering

- Automatic SMS and WhatsApp reminders through Termii or the WhatsApp Business API. Today they are one-tap click-to-chat links.
- Paystack subaccounts, so online payments settle directly to each business, plus deposits for long services.
- Limiting which services each team member offers, plus staff time off and breaks.
- Reviews and ratings, gift cards, packages and memberships.
- Multiple locations per business, and staff logins with roles.
