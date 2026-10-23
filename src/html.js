// Tiny auto-escaping template helper: every interpolated value is HTML-escaped
// unless it is itself the result of html`` or raw().
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Raw(String(s));

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Raw(out);
}

export const APP_NAME = process.env.APP_NAME || 'BookNaija';

export function page({ title, body, user, flash, error, bodyClass = '' }) {
  return `<!doctype html>
<html lang="en-NG">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} · ${APP_NAME}` : APP_NAME)}</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%236C47FF'/><text x='16' y='22' font-size='16' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'>B</text></svg>">
</head>
<body class="${esc(bodyClass)}">
${render(body instanceof Raw || Array.isArray(body) ? body : raw(body))}
${flash ? `<div class="toast" role="status">${esc(flash)}</div>` : ''}
${error ? `<div class="toast toast-error" role="alert">${esc(error)}</div>` : ''}
<script src="/app.js" defer></script>
</body>
</html>`;
}

export function publicHeader(user) {
  return html`<header class="site-header">
  <a class="brand" href="/"><span class="logo">B</span>${APP_NAME}</a>
  <nav>
    ${user
      ? html`<a class="btn btn-sm" href="/dashboard">Dashboard</a>`
      : html`<a href="/login">Log in</a><a class="btn btn-sm" href="/signup">List your business</a>`}
  </nav>
</header>`;
}
