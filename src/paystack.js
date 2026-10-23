import crypto from 'node:crypto';

// Thin Paystack client. Online payment is switched on by setting PAYSTACK_SECRET_KEY;
// without it, customers pay at the venue and owners record payments in the dashboard.
export function createPaystack({ secretKey, fetchImpl = globalThis.fetch, baseUrl = 'https://api.paystack.co' } = {}) {
  async function call(method, path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok || !json.status) throw new Error(`Paystack ${path} failed: ${json.message || res.status}`);
    return json.data;
  }

  return {
    enabled: Boolean(secretKey),

    async initialize({ email, amountKobo, reference, callbackUrl, metadata }) {
      const data = await call('POST', '/transaction/initialize', {
        email, amount: amountKobo, currency: 'NGN', reference, callback_url: callbackUrl, metadata,
      });
      return data.authorization_url;
    },

    // Returns { paid, amountKobo, reference }.
    async verify(reference) {
      const data = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      return { paid: data.status === 'success' && data.currency === 'NGN', amountKobo: data.amount, reference: data.reference };
    },

    verifyWebhook(rawBody, signature) {
      if (!secretKey || !signature) return false;
      const expected = Buffer.from(crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex'));
      const actual = Buffer.from(String(signature));
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    },
  };
}
