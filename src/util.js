import crypto from 'node:crypto';

// Nigeria is on West Africa Time (UTC+1) all year, with no daylight saving.
// Appointment times are stored as local WAT strings: 'YYYY-MM-DD HH:MM'.
const WAT_OFFSET_MS = 60 * 60 * 1000;

export function nowWAT() {
  return new Date(Date.now() + WAT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

export const todayWAT = () => nowWAT().slice(0, 10);

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(date) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];
}

// Monday of the week containing `date`.
export function weekStart(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export const monthStart = (date) => `${date.slice(0, 7)}-01`;

export function prevMonthStart(date) {
  const d = new Date(`${monthStart(date)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMin(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function fmtDate(date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T00:00:00Z`));
}

export function fmtTime(hhmm) {
  const min = toMin(hhmm);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

export function fmtDuration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

// Money is stored in kobo (integer) to avoid floating point errors.
export function formatNaira(kobo) {
  const naira = (kobo || 0) / 100;
  const fraction = kobo % 100 ? 2 : 0;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: fraction, maximumFractionDigits: fraction })}`;
}

export function parseNaira(input) {
  const n = Number(String(input ?? '').replace(/[₦,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

// Accepts 0803..., 803..., 234803..., +234 803 ... and returns +234XXXXXXXXXX.
export function normalizePhone(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('234')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^[789]\d{9}$/.test(d) ? `+234${d}` : null;
}

export function displayPhone(phone) {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(phone || '');
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : phone || '';
}

export function waLink(phone, text = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'business';
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRef() {
  const bytes = crypto.randomBytes(8);
  return `BK${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
