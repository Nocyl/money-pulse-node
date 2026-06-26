/**
 * @moneypulse/node — Official Money-Pulse SDK
 *
 * Aligned with real backend routes (backend/src/routes/index.ts).
 * Zero runtime deps — uses native fetch (Node 18+).
 */
import * as crypto from 'node:crypto';

export type Environment = 'sandbox' | 'production';

export interface MoneyPulseConfig {
  apiKey: string;
  environment?: Environment;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class MoneyPulseError extends Error {
  constructor(message: string, public status?: number, public code?: string, public raw?: unknown) {
    super(message);
    this.name = 'MoneyPulseError';
  }
}
export class AuthenticationError extends MoneyPulseError { constructor(m: string, r?: unknown) { super(m, 401, 'authentication_error', r); this.name = 'AuthenticationError'; } }
export class ValidationError extends MoneyPulseError    { constructor(m: string, r?: unknown) { super(m, 400, 'validation_error', r); this.name = 'ValidationError'; } }
export class RateLimitError extends MoneyPulseError     { constructor(m: string, r?: unknown) { super(m, 429, 'rate_limited', r); this.name = 'RateLimitError'; } }
export class NetworkError extends MoneyPulseError       { constructor(m: string, r?: unknown) { super(m, undefined, 'network_error', r); this.name = 'NetworkError'; } }

export interface PaymentInitiateInput {
  amount: number;
  currency: string;
  country?: string;
  customer: { phone?: string; email?: string; firstName?: string; lastName?: string };
  methodCode?: string;
  method?: string;
  description?: string;
  callbackUrl?: string;
  returnUrl?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

export interface PayoutInitiateInput {
  amount: number;
  currency: string;
  country?: string;
  recipient: { phone?: string; email?: string; firstName?: string; lastName?: string; accountNumber?: string; bankCode?: string };
  methodCode?: string;
  method?: string;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export class MoneyPulse {
  readonly apiKey: string;
  readonly environment: Environment;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;

  payments: PaymentsResource;
  payouts: PayoutsResource;
  methods: MethodsResource;
  customers: CustomersResource;
  refunds: RefundsResource;
  balances: BalancesResource;
  webhooks: WebhooksHelper;

  constructor(cfg: MoneyPulseConfig) {
    if (!cfg.apiKey) throw new AuthenticationError('apiKey is required');
    this.apiKey = cfg.apiKey;
    this.environment = cfg.environment ?? (cfg.apiKey.startsWith('mp_live_') ? 'production' : 'sandbox');
    this.baseUrl = cfg.baseUrl ?? 'https://api.money-pulse.org/api/v1';
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
    this.maxRetries = cfg.maxRetries ?? 3;

    this.payments = new PaymentsResource(this);
    this.payouts = new PayoutsResource(this);
    this.methods = new MethodsResource(this);
    this.customers = new CustomersResource(this);
    this.refunds = new RefundsResource(this);
    this.balances = new BalancesResource(this);
    this.webhooks = new WebhooksHelper();
  }

  async request<T = any>(method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    const url = new URL(this.baseUrl.replace(/\/+$/, '') + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': this.apiKey,
            'X-SDK': '@moneypulse/node@0.1.0',
            'User-Agent': '@moneypulse/node/0.1.0',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await res.text();
        const json = text ? safeJson(text) : null;
        if (!res.ok) {
          const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
          if (res.status === 401) throw new AuthenticationError(msg, json);
          if (res.status === 400) throw new ValidationError(msg, json);
          if (res.status === 429) throw new RateLimitError(msg, json);
          if (res.status >= 500 && attempt < this.maxRetries) {
            await sleep(backoff(attempt));
            continue;
          }
          throw new MoneyPulseError(msg, res.status, json?.code, json);
        }
        return (json?.data ?? json) as T;
      } catch (err) {
        lastErr = err;
        if (err instanceof MoneyPulseError && err.status && err.status < 500) throw err;
        if (attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? new NetworkError(lastErr.message, lastErr) : new NetworkError('Request failed');
  }
}

class PaymentsResource {
  constructor(private mp: MoneyPulse) {}
  initiate(input: PaymentInitiateInput) { return this.mp.request('POST', '/payments/initiate', input); }
  getStatus(transactionId: string) { return this.mp.request('GET', `/payments/${encodeURIComponent(transactionId)}/status`); }
  list(query?: { page?: number; limit?: number; status?: string }) { return this.mp.request('GET', '/payments', undefined, query); }
  notify(input: { transactionId: string; email: string }) { return this.mp.request('POST', '/payments/notify', input); }
}

class PayoutsResource {
  constructor(private mp: MoneyPulse) {}
  initiate(input: PayoutInitiateInput) { return this.mp.request('POST', '/payouts', input); }
  list(query?: { page?: number; limit?: number; status?: string }) { return this.mp.request('GET', '/payouts', undefined, query); }
  balance() { return this.mp.request('GET', '/payouts/balance'); }
}

class MethodsResource {
  constructor(private mp: MoneyPulse) {}
  list(query?: { country?: string; currency?: string; restrictedPhone?: string; restrictCountryCode?: string; type?: string }) {
    return this.mp.request('GET', '/utils/payment/methods', undefined, {
      country: query?.country,
      currency: query?.currency,
      restricted_phone: query?.restrictedPhone,
      restrict_country_code: query?.restrictCountryCode,
      type: query?.type,
    });
  }
}

class CustomersResource {
  constructor(private mp: MoneyPulse) {}
  list(query?: { page?: number; limit?: number; search?: string }) { return this.mp.request('GET', '/customers', undefined, query); }
  create(input: { firstName?: string; lastName?: string; email?: string; phone?: string }) { return this.mp.request('POST', '/customers', input); }
  get(id: string) { return this.mp.request('GET', `/customers/${encodeURIComponent(id)}`); }
  update(id: string, input: Partial<{ firstName: string; lastName: string; email: string; phone: string }>) {
    return this.mp.request('PUT', `/customers/${encodeURIComponent(id)}`, input);
  }
  delete(id: string) { return this.mp.request('DELETE', `/customers/${encodeURIComponent(id)}`); }
}

class RefundsResource {
  constructor(private mp: MoneyPulse) {}
  list() { return this.mp.request('GET', '/refunds'); }
  create(input: { transactionId: string; amount?: number; reason?: string }) { return this.mp.request('POST', '/refunds', input); }
}

class BalancesResource {
  constructor(private mp: MoneyPulse) {}
  summary() { return this.mp.request('GET', '/balances/summary'); }
}

export class WebhooksHelper {
  /**
   * Verify a Money-Pulse outgoing webhook signature.
   * Header: X-MoneyPulse-Signature (hex sha256(secret, rawBody)).
   */
  verifySignature(rawBody: string | Buffer, signatureHeader: string, secret: string): boolean {
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signatureHeader, 'hex'));
    } catch {
      return false;
    }
  }
}

function safeJson(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function backoff(attempt: number) { return Math.min(2_000 * Math.pow(2, attempt), 10_000); }

export default MoneyPulse;
