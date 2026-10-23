import { hashPassword } from './auth.js';
import { availableSlots } from './booking.js';
import { DEFAULT_HOURS, transaction } from './db.js';
import { addDays, fromMin, makeRef, nowWAT, toMin } from './util.js';

const BUSINESSES = [
  {
    owner: ['Adaeze Okafor', 'demo@booknaija.ng'],
    slug: 'glow-lounge-lekki', name: 'Glow Lounge Spa & Salon', category: 'Spa', city: 'Lagos', area: 'Lekki Phase 1',
    address: '14 Admiralty Way', phone: '+2348031234567',
    description: 'A calm escape off Admiralty Way. Massages, facials and nails by a friendly, certified team. Free parking and Wi-Fi.',
    hours: { ...DEFAULT_HOURS, sun: { open: '12:00', close: '17:00' } },
    staff: [['Adaeze', 'Owner & lead therapist'], ['Tolu', 'Massage therapist'], ['Chioma', 'Nail technician'], ['Ifeoma', 'Esthetician']],
    services: [
      ['Swedish massage', 60, 25000], ['Deep tissue massage', 90, 38000], ['Hot stone massage', 75, 32000],
      ['Classic facial', 60, 18000], ['Hydrating glow facial', 75, 27000], ['Gel manicure', 45, 8000],
      ['Spa pedicure', 60, 10000], ['Couples massage (per person)', 60, 30000],
    ],
  },
  {
    owner: ['Musa Abdullahi', 'kings@booknaija.ng'],
    slug: 'kings-cut-wuse', name: 'Kings Cut Barbershop', category: 'Barber', city: 'Abuja', area: 'Wuse 2',
    address: 'Plot 12, Aminu Kano Crescent', phone: '+2348091112233',
    description: 'Clean fades, sharp line-ups and beard care. Walk-ins welcome, bookings get priority.',
    hours: { ...DEFAULT_HOURS, mon: { open: '08:00', close: '20:00' }, sat: { open: '08:00', close: '20:00' }, sun: { open: '13:00', close: '18:00' } },
    staff: [['Musa', 'Master barber'], ['Emeka', 'Barber'], ['Sani', 'Barber']],
    services: [['Haircut', 30, 5000], ['Haircut + beard', 45, 7500], ['Kids cut (under 12)', 30, 3500], ['Beard shape-up', 20, 3000], ['Hair dye', 60, 10000], ['Royal treatment (cut, beard, facial)', 90, 18000]],
  },
  {
    owner: ['Bisola Adeyemi', 'bisi@booknaija.ng'],
    slug: 'braids-by-bisi-yaba', name: 'Braids by Bisi', category: 'Hair salon', city: 'Lagos', area: 'Yaba',
    address: '3 Herbert Macaulay Way', phone: '+2348025556677',
    description: 'Neat, long-lasting braids and protective styles. Hair extensions available on request.',
    hours: { ...DEFAULT_HOURS, mon: null, tue: { open: '08:00', close: '19:00' }, sat: { open: '07:00', close: '19:00' } },
    staff: [['Bisi', 'Owner & stylist'], ['Kemi', 'Braider'], ['Halima', 'Braider']],
    services: [['Knotless braids (medium)', 240, 35000], ['Box braids (small)', 300, 45000], ['Cornrows', 90, 10000], ['Wig install', 90, 15000], ['Silk press', 120, 20000], ['Kids braids', 120, 12000]],
  },
  {
    owner: ['Ebiere Douglas', 'lash@booknaija.ng'],
    slug: 'lash-republic-ph', name: 'Lash Republic', category: 'Lashes & brows', city: 'Port Harcourt', area: 'GRA Phase 2',
    address: '22 Tombia Street', phone: '+2348067778899',
    description: 'Lash extensions, brow lamination and microblading in a cosy studio.',
    hours: DEFAULT_HOURS,
    staff: [['Ebiere', 'Lash artist'], ['Precious', 'Brow specialist']],
    services: [['Classic lash set', 90, 15000], ['Volume lash set', 120, 22000], ['Lash refill', 60, 9000], ['Brow lamination', 45, 12000], ['Microblading', 150, 60000]],
  },
  {
    owner: ['Nkechi Eze', 'nails@booknaija.ng'],
    slug: 'polished-nail-bar-ikeja', name: 'Polished Nail Bar', category: 'Nails', city: 'Lagos', area: 'Ikeja GRA',
    address: '7 Isaac John Street', phone: '+2348183334455',
    description: 'Acrylics, gel-x and nail art. Sterilised tools every time.',
    hours: DEFAULT_HOURS,
    staff: [['Nkechi', 'Nail artist'], ['Funmi', 'Nail technician']],
    services: [['Acrylic full set', 90, 15000], ['Gel-X extensions', 90, 18000], ['Gel polish (hands)', 45, 7000], ['Pedicure', 60, 8000]],
  },
];

const FIRST = ['Chinonso', 'Aisha', 'Tunde', 'Ngozi', 'Ibrahim', 'Funke', 'Emeka', 'Zainab', 'Seun', 'Amaka', 'Yusuf', 'Kemi', 'Obinna', 'Halima', 'Dayo',
  'Uche', 'Fatima', 'Bola', 'Chidi', 'Hauwa', 'Tobi', 'Nneka', 'Ahmed', 'Yetunde', 'Ikenna', 'Blessing', 'Femi', 'Precious', 'Kelechi', 'Maryam'];
const LAST = ['Okonkwo', 'Bello', 'Adeyemi', 'Eze', 'Mohammed', 'Ogunleye', 'Nwosu', 'Abubakar', 'Balogun', 'Okeke', 'Lawal', 'Obi', 'Ojo', 'Danjuma', 'Akande'];

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDemo(db, { now = nowWAT(), pastDays = 75, futureDays = 10 } = {}) {
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const password = hashPassword('demo1234');
  const today = now.slice(0, 10);
  let total = 0;

  transaction(db, () => {
    for (const [bi, b] of BUSINESSES.entries()) {
      const ownerId = Number(db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(b.owner[0], b.owner[1], password).lastInsertRowid);
      const bizId = Number(db.prepare(`INSERT INTO businesses (owner_id, slug, name, category, description, address, area, city, phone, whatsapp, hours, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ownerId, b.slug, b.name, b.category, b.description, b.address, b.area, b.city,
        b.phone, b.phone, JSON.stringify(b.hours), `${addDays(today, -pastDays - 30)} 09:00:00`).lastInsertRowid);
      const staffIds = b.staff.map(([name, role]) => Number(db.prepare('INSERT INTO staff (business_id, name, role) VALUES (?, ?, ?)').run(bizId, name, role).lastInsertRowid));
      const services = b.services.map(([name, duration, naira]) => ({
        id: Number(db.prepare('INSERT INTO services (business_id, name, duration_min, price_kobo) VALUES (?, ?, ?, ?)').run(bizId, name, duration, naira * 100).lastInsertRowid),
        duration, price: naira * 100,
      }));

      // A pool of regulars makes returning-customer stats realistic.
      const poolSize = 150 + bi * 20;
      const customers = Array.from({ length: poolSize }, (_, i) => {
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const phone = `+234${pick(['803', '806', '810', '813', '816', '703', '706', '802', '808', '812', '701', '902', '905'])}${String(1000000 + Math.floor(rand() * 8999999)).slice(0, 7)}`;
        const created = addDays(today, -pastDays + Math.floor((i / poolSize) * (pastDays + futureDays)));
        return Number(db.prepare('INSERT OR IGNORE INTO customers (business_id, name, phone, created_at) VALUES (?, ?, ?, ?)').run(bizId, name, phone, `${created} 10:00:00`).lastInsertRowid);
      }).filter(Boolean);

      const insert = db.prepare(`INSERT INTO bookings (ref, business_id, customer_id, service_id, staff_id, starts_at, ends_at, status, price_kobo,
        payment_status, payment_method, paid_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      for (let d = -pastDays; d <= futureDays; d++) {
        const date = addDays(today, d);
        const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
        // Busier on Fri/Sat, growing slightly over time.
        const base = (dow === 5 || dow === 6 ? 7 : 4) + Math.floor(((d + pastDays) / pastDays) * 2);
        const target = d > 0 ? Math.max(1, Math.floor(base * (0.7 - d * 0.05))) : base + Math.floor(rand() * 3) - 1;
        // Customers join over time, so later bookings mix regulars with new faces.
        const known = Math.max(12, Math.floor(customers.length * ((d + pastDays + 1) / (pastDays + futureDays + 1))));
        const placed = [];
        for (let k = 0; k < target * 2 && placed.length < target; k++) {
          const svc = rand() < 0.5 ? services[Math.floor(rand() * Math.min(3, services.length))] : pick(services);
          const slots = availableSlots({ hours: b.hours, date, duration: svc.duration, step: 30, staffIds, bookings: placed, now: `${date} 00:00`, leadMin: 0 });
          if (!slots.length) continue;
          const slot = slots[Math.floor(rand() * slots.length)];
          const staffId = pick(slot.staffIds);
          const start = `${date} ${slot.time}`;
          const end = `${date} ${fromMin(toMin(slot.time) + svc.duration)}`;
          placed.push({ staff_id: staffId, starts_at: start, ends_at: end });

          const past = start < now;
          const roll = rand();
          let status = 'confirmed';
          let paid = false;
          if (past) {
            if (roll < 0.06) status = 'cancelled';
            else if (roll < 0.1) status = 'no_show';
            else { status = 'completed'; paid = rand() > 0.05 || d < -10; }
          } else if (roll < 0.05) status = 'cancelled';
          else if (roll < 0.2) paid = true; // prepaid online
          const method = paid ? (past ? pick(['transfer', 'transfer', 'transfer', 'pos', 'pos', 'cash', 'paystack']) : 'paystack') : null;
          const source = rand() < 0.65 ? 'online' : pick(['walk_in', 'phone']);
          insert.run(makeRef(), bizId, customers[Math.floor(rand() ** 1.6 * known)], svc.id, staffId, start, end, status, svc.price,
            paid ? 'paid' : 'unpaid', method, paid ? `${date} ${slot.time}:00` : null, source, `${addDays(date, -Math.floor(rand() * 7))} 09:00:00`);
          total++;
        }
      }
    }
  });

  return { businesses: BUSINESSES.length, bookings: total };
}
