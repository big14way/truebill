# TrueBill: verify before your agent pays

Invoice fraud ("we changed our bank details") is one of the oldest scams. Once agents pay invoices
automatically, it gets worse. TrueBill is an x402-native PayBox plugin:

1. Merchants sign invoices (EIP-712) with a registered key.
2. Before paying, an agent calls `GET /api/check?url=<invoice>` ($0.01 via x402). TrueBill checks the
   signature, payout address, network, issuance and payment status.
3. If safe, the agent pays `GET /api/pay/<id>` via x402. Funds go only to the merchant's registered
   payout address, never to an address taken from the invoice itself.

Stack: Express, @x402/express (v2, exact scheme, USDC on Base), PayAI facilitator, viem, Upstash Redis.
Works with PayBox's `use_service` tool in Claude or the `paybox` CLI.

## How it works

```
Merchant (Ada Studio)            TrueBill server                         Payer's agent (Claude + PayBox)
---------------------            ---------------                         -------------------------------
sign invoice (EIP-712)  ──────►  POST /api/invoices
                                 (checks signature, stores it)
                                 GET  /i/:id         (invoice document)  ◄── user pastes invoice links
                                 GET  /api/check?url=<link>   ◄──────────── use_service  ($0.01, x402)
                                   → SAFE_TO_PAY + payUrl
                                   → or DO_NOT_PAY + reasons
                                 GET  /api/pay/:id            ◄──────────── use_service  (invoice amount, x402)
                                   → USDC goes to the merchant's REGISTERED payout address
                                   → receipt; invoice marked paid
```

### The checks `/api/check` runs

| Check | What it catches |
|---|---|
| `document_format` | Junk or malformed invoices |
| `merchant_registered` | A merchant TrueBill doesn't know |
| `signature_valid` | Invoices not signed by the merchant's registered key (forgeries) |
| `payee_matches` | "We changed our wallet, pay this new address" scams |
| `network_matches` | Invoices for the wrong chain |
| `issued_via_truebill` | Edited copies of real invoices |
| `not_already_paid` | Duplicate invoices and double payment |

**Key design rule:** money only ever goes to the payout address in TrueBill's registry, never to an
address or link taken from the invoice document. Even a perfect-looking fake can't redirect funds.

## Endpoints

| Route | Price | Purpose |
|---|---|---|
| `GET /` | free | Manifest + agent instructions |
| `GET /health` | free | Liveness |
| `GET /i/:id` | free | The signed invoice document |
| `GET /api/invoices/:id` | free | Status, tx hash, explorer link |
| `POST /api/invoices` | admin token | Merchant registers a signed invoice |
| `GET /api/check?url=` | $0.01 (x402) | Verify an invoice link |
| `GET /api/pay/:id` | invoice amount (x402) | Pay a verified invoice |

## Run it locally

```bash
npm install
npm run keys > keys.txt          # four throwaway wallets
cp .env.example .env             # fill in from keys.txt
# put MERCHANT_SIGNER / MERCHANT_PAYOUT addresses in merchants.json
npm run dev
```

In a second terminal:

```bash
curl http://localhost:3000/health
npm run invoice -- 0.50 Logo design final files   # prints Invoice link + Check URL
curl -i "<Check URL>"                             # 402 + PAYMENT-REQUIRED header
```

### Testnet payments (Base Sepolia, free)

Fund `TEST_BUYER_ADDRESS` with Base Sepolia USDC from https://faucet.circle.com, then:

```bash
npm run buy -- "<Check URL>"    # SAFE_TO_PAY + payUrl
npm run buy -- "<payUrl>"       # receipt + settlement tx
npm run buy -- "<payUrl>"       # 409: already paid
npm run forge                   # writes forged-invoice.json; host it on a gist (Raw URL)
npm run checkurl -- <raw gist URL>
npm run buy -- "<that check URL>"   # DO_NOT_PAY with 3 reasons
```

## Agent prompt (Claude + PayBox)

```
I got two invoices from Ada Studio today:
A) <REAL INVOICE LINK>
B) <FORGED LINK>

TrueBill (<server URL>) verifies invoices before they're paid.
For each invoice, call <server URL>/api/check?url=<URL-encoded invoice link>
using the PayBox use_service tool with my EVM wallet. Pay only invoices whose verdict is
SAFE_TO_PAY, and pay them only by calling the payUrl TrueBill returns, again with use_service.
For anything you don't pay, tell me exactly why.
```

## Deploy (Render)

Build `npm install`, start `npm start`, Node 22+. Environment:

```
NETWORK=testnet|mainnet
PUBLIC_BASE_URL=https://<service>.onrender.com
ADMIN_TOKEN=<long random string>
FEE_PAY_TO=<TRUEBILL_FEE address>
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Never put merchant or buyer keys on the server. The merchant signs on its own machine.

## Project layout

```
src/config.ts      env + chain constants
src/merchants.ts   registry of merchant signer / payout addresses (merchants.json)
src/invoice.ts     EIP-712 invoice schema, zod validation, signer recovery
src/store.ts       Upstash Redis store (in-memory fallback)
src/check.ts       the seven fraud checks
src/server.ts      Express app, x402 paywall, paid handlers
scripts/           gen-keys, create-invoice, forge-invoice, check-url, test-buyer
```

Built for the MoonPay PayBox Hackathon (Chapter 1).
