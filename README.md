# @moneypulse/node

SDK officiel Money-Pulse pour Node.js / TypeScript. Zéro dépendance runtime, dual ESM/CJS, retry automatique sur 5xx.

## Installation

```bash
npm install @moneypulse/node
```

## Utilisation

```ts
import MoneyPulse from '@moneypulse/node';

const mp = new MoneyPulse({ apiKey: process.env.MONEYPULSE_API_KEY! });

// Initier un paiement
const payment = await mp.payments.initiate({
  amount: 5000,
  currency: 'XOF',
  country: 'CI',
  customer: { phone: '+2250700000000', email: 'client@example.com' },
  callbackUrl: 'https://example.com/api/webhook',
  returnUrl: 'https://example.com/merci',
  reference: 'ORDER-1234',
});

// Vérifier le statut
const status = await mp.payments.getStatus(payment.transactionId);

// Lister les méthodes pour un téléphone donné
const methods = await mp.methods.list({ restrictedPhone: '+2250700000000', currency: 'XOF' });

// Vérifier la signature d'un webhook entrant (Express)
app.post('/webhooks/moneypulse', express.raw({ type: '*/*' }), (req, res) => {
  const ok = mp.webhooks.verifySignature(req.body, req.header('X-MoneyPulse-Signature')!, process.env.WEBHOOK_SECRET!);
  if (!ok) return res.status(401).end();
  // ...
  res.json({ received: true });
});
```

## Resources

- `mp.payments.initiate / getStatus / list / notify`
- `mp.payouts.initiate / list / balance`
- `mp.methods.list`
- `mp.customers.list / create / get / update / delete`
- `mp.refunds.list / create`
- `mp.balances.summary`
- `mp.webhooks.verifySignature`

## Erreurs typées

`MoneyPulseError`, `AuthenticationError`, `ValidationError`, `RateLimitError`, `NetworkError`.
