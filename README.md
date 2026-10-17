# TrueBill

**Verify before your agent pays.** TrueBill is the fraud check an AI agent runs before it pays an invoice: a one-cent x402 call that confirms the invoice is genuine, then a payment that can only reach the merchant's registered wallet.

| | |
|---|---|
| **Live service** | https://truebill.onrender.com (Base mainnet) |
| **Demo video** | https://x.com/Big14teru/status/2111502501363298336 |
| **PayBox plugin** | `TrueBill`, submitted to the MoonPay PayBox Hackathon, Chapter 1 |
| **On-chain proof** | [0x4f52c986…1a84](https://basescan.org/tx/0x4f52c9867fbbb2d25241b18f14b12d33cf51871a2ad64b06966628ed1ee51a84): 0.50 USDC paid by Claude through the plugin to the merchant's registered address |

---

## 1. The problem

Invoice fraud is one of the oldest scams in business. A supplier's real invoice is copied, one line is changed ("we have updated our bank details"), and the money goes to the attacker. The FBI's Internet Crime Complaint Center groups this under business email compromise, which costs victims billions of dollars every year. It works because the person paying is busy, the document looks right, and nobody calls the supplier to check.

AI agents are about to make this worse. An agent that pays invoices automatically is busy all the time, pays in seconds, and has no out-of-band way to confirm a wallet address. Payment rails built for agents (x402, PayBox) solve *how* an agent pays. They do not answer the question that matters first: **should this invoice be paid at all, and to whom?**

Three failure modes an agent cannot detect on its own:

1. **Forgery.** A document that names a real merchant but was never produced by them.
2. **Payee substitution.** A real-looking invoice whose payout address has been swapped.
3. **Duplicates.** The same invoice presented twice, or a paid invoice replayed.

## 2. The solution

TrueBill puts a verification step between "the agent decides to pay" and "money moves", and makes the payment itself go through that step.

1. **Merchants register once.** A merchant's identity in TrueBill is two addresses: a *signer* key that signs invoices and a *payout* address that receives money. Neither can be changed by an invoice.
2. **Merchants sign invoices.** Every invoice is an EIP-712 typed-data document signed by the merchant's signer key and registered with TrueBill. The merchant's private key never touches TrueBill's server.
3. **Agents check before paying.** `GET /api/check?url=<invoice link>` costs $0.01 USDC over x402 and runs seven checks. The response is a verdict, `SAFE_TO_PAY` or `DO_NOT_PAY`, with the reasons and, if safe, a `payUrl`.
4. **Agents pay through TrueBill.** `GET /api/pay/<invoiceId>` is an x402 endpoint priced at the signed invoice amount. The recipient of that payment is looked up in TrueBill's registry at request time. It is never read from the invoice document, the URL, or the agent's input.

The design rule that makes this safe: **money never follows the document. It follows the registry.** A perfect forgery can change what an invoice *says*, but it cannot change where TrueBill *sends* funds.

### The seven checks

| Check | What it catches |
|---|---|
| `document_format` | Junk, malformed, or non-TrueBill documents |
| `merchant_registered` | A merchant TrueBill has never heard of |
| `signature_valid` | Documents not signed by the merchant's registered key (forgeries, tampered amounts) |
| `payee_matches` | "We changed our wallet, pay this new address" |
| `network_matches` | Invoices for the wrong chain |
| `issued_via_truebill` | Edited copies of real invoices (the exact document must be on record) |
| `not_already_paid` | Duplicate invoices and replayed payments |

All seven must pass for `SAFE_TO_PAY`. The same checks are shown free of charge on the human-readable invoice page; agents pay for the machine-readable verdict.

## 3. Architecture

```
┌──────────────────────┐      POST /api/invoices        ┌──────────────────────────────┐
│  Merchant            │  (admin token, signed doc)     │  TrueBill server             │
│  scripts/create-     │ ─────────────────────────────▶ │  Express + @x402/express     │
│  invoice.ts          │                                │                              │
│  signs EIP-712 with  │  ◀── invoice link /i/<id> ──── │  registry  merchants.json    │
│  MERCHANT_SIGNER_KEY │                                │  store     Upstash Redis     │
└──────────────────────┘                                │  checks    src/check.ts      │
                                                        │  paywall   PayAI facilitator │
┌──────────────────────┐                                │            USDC on Base      │
│  Payer's agent       │   use_plugin check_invoice     └──────────────┬───────────────┘
│  Claude + PayBox     │ ─────────────────────────────▶ x402 proposal  │  GET /api/check?url=…  $0.01
│                      │                                                │  → verdict + payUrl
│  TrueBill plugin     │   use_plugin pay_invoice                       │
│  plugin/dist/        │ ─────────────────────────────▶ x402 proposal  │  GET /api/pay/<id>  (amount)
│  plugin.mjs          │                                                │  → payTo = registry payout
└──────────┬───────────┘                                                │  → receipt, invoice = paid
           │  PayBox validates the 402 challenge, asks the user,        │
           └─ signs the USDC authorization, settles via facilitator ───▶ merchant's registered wallet
```

### Components

| Component | Role |
|---|---|
| `src/server.ts` | Express 5 app. Free routes (manifest, health, invoice document, status), admin route to register invoices, guards, the x402 paywall, and the two paid handlers. |
| `src/check.ts` | Loads an invoice document (from TrueBill's own store or over HTTPS with SSRF guards) and runs the seven checks. |
| `src/invoice.ts` | EIP-712 schema, zod validation, signer recovery. Shared by server and merchant scripts. |
| `src/merchants.ts` | The registry: merchant id, name, signer address, payout address. Validated with `getAddress` at startup. |
| `src/store.ts` | Invoice records and status (`unpaid`, `settling`, `paid`, tx hash). Upstash Redis in production, in-memory locally. |
| `src/html.ts` | Human-readable landing and invoice pages. Content negotiation keeps JSON for agents. |
| `plugin/` | The PayBox plugin: an MCP server bundled to `dist/plugin.mjs` whose tools return x402 payment proposals. |
| `scripts/` | Merchant and test tooling: key generation, invoice creation and signing, a forged-invoice generator, a testnet x402 buyer. |

### Payment flow in detail

1. The agent calls the plugin's `check_invoice` with the invoice link. The plugin returns an x402 *proposal* (URL, method, asset, maximum amount) for `GET /api/check`. No network call is made inside the plugin for this step.
2. PayBox fetches the live 402 challenge from TrueBill, verifies the asset and amount against the proposal, shows it to the user, and signs a USDC `transferWithAuthorization`. The facilitator settles it on Base and retries the request with the payment header.
3. TrueBill returns the verdict. If `SAFE_TO_PAY`, the agent calls `pay_invoice` with the invoice id.
4. The plugin reads the free status endpoint, refuses if the invoice is already paid or settling, and returns a proposal for `GET /api/pay/<id>` with `maxAmount` equal to the signed amount.
5. TrueBill's 402 challenge for that route prices the request at the invoice amount and sets `payTo` to the merchant's registered payout address from the registry. PayBox pays it, TrueBill marks the invoice `settling` then `paid`, and records the transaction hash from the settlement header.
6. Any later `pay_invoice` or `/api/pay` call for that id is refused (plugin: `isError`; server: HTTP 409).

### Trust boundaries

- **Merchant signing keys** stay on the merchant's machine. The server verifies signatures; it never holds the key.
- **The server holds no funds.** The check fee goes to a fee address and invoice payments go to merchant payout addresses, both set by configuration. x402 settlement is non-custodial.
- **The invoice document is untrusted input.** Nothing in it can change the payee or the amount charged. The amount charged is the signed amount on record; the payee is the registry entry.
- **The payer's wallet** is controlled by PayBox and the user's passkey. The plugin never sees keys and cannot move money by itself; it can only propose.
- **External invoice links** are fetched with a 5 s timeout, a 50 KB cap, HTTPS only, and private-network hosts blocked.

## 4. API

| Route | Price | Purpose |
|---|---|---|
| `GET /` | free | Manifest with agent instructions (HTML for browsers, `?format=json` for machines) |
| `GET /health` | free | Liveness and network |
| `GET /i/:id` | free | The signed invoice document (HTML page for browsers, JSON for agents) |
| `GET /api/invoices/:id` | free | Status, `paidAt`, `txHash`, explorer link |
| `POST /api/invoices` | admin token | Merchant registers a signed invoice; server re-verifies signer, payee, chain, amount |
| `GET /api/check?url=` | $0.01 via x402 | The seven checks; returns verdict, reasons, `payUrl` |
| `GET /api/pay/:id` | invoice amount via x402 | Pays the merchant's registered address; returns a receipt |

Example verdict (abridged):

```json
{
  "verdict": "DO_NOT_PAY",
  "invoiceId": "inv_1741ac39419e",
  "merchant": { "id": "ada-studio", "name": "Ada Studio", "verified": true },
  "amount": "0.75",
  "reasons": [
    "NOT signed with Ada Studio's registered key (signed by 0x5e59…d5A6)",
    "Payout address 0x2B9e…55DC is NOT Ada Studio's registered address 0xfDb9…1622",
    "TrueBill has no record of this exact invoice"
  ],
  "payUrl": null
}
```

## 5. PayBox plugin

The hackathon artifact is `plugin/dist/plugin.mjs`, built from `plugin/src/plugin.ts` with the PayBox starter toolchain (Node 24, pnpm 11.11.0). It exposes three MCP tools:

| Tool | Input | Returns | Cost |
|---|---|---|---|
| `check_invoice` | `invoiceUrl` | x402 proposal for `/api/check` | 0.01 USDC |
| `pay_invoice` | `invoiceId` | x402 proposal for `/api/pay/<id>`, or an error if not payable | invoice amount |
| `invoice_status` | `invoiceId` | status, tx hash, explorer link | free |

Hosted configuration: network host `truebill.onrender.com`, no secrets, no environment variables required (`TRUEBILL_URL` optionally overrides the base URL).

```bash
cd plugin
pnpm install --frozen-lockfile
pnpm test        # typecheck, deterministic build, MCP conformance → dist/plugin.mjs
```

### Try it in Claude

1. Add `https://api.paybox.sh/mcp` as a custom connector in Claude and sign in to PayBox.
2. Enable the **TrueBill** plugin under Plugins in app.paybox.sh.
3. Paste:

```
I got two invoices from Ada Studio today:
A) <REAL INVOICE LINK>
B) <FORGED LINK>
Use the PayBox TrueBill plugin with my EVM wallet. Run check_invoice on each one first,
and reopen the PayBox signing window right after each plugin call so I can approve it.
Pay only invoices whose verdict is SAFE_TO_PAY, and pay them only with pay_invoice.
For anything you don't pay, tell me exactly why.
```

The first time a Claude connection signs, PayBox asks for a one-time emoji verification and your passkey. If a card says it is waiting for a signing key, reload the conversation and ask Claude to reopen the signing window.

The same flow also works with PayBox's `use_service` tool against `/api/check?url=` and the returned `payUrl`, or with the `paybox` CLI.

## 6. What was verified

| Environment | Result |
|---|---|
| Local, Base Sepolia | Invoice created and signed; `/api/check` returns 402; paid check returns `SAFE_TO_PAY`; paid invoice settles; second payment returns 409; forged gist returns `DO_NOT_PAY` with three reasons; paid invoice re-check returns `DO_NOT_PAY` |
| Render, Base Sepolia | Same suite against the deployed service with Upstash Redis |
| Render, Base mainnet, PayBox CLI | Check and payment through `paybox use-service`; USDC transfer to the registered payout confirmed on BaseScan |
| Render, Base mainnet, Claude + plugin | Full agent flow in Claude: both checks, `SAFE_TO_PAY` for the real invoice, payment through `pay_invoice`, `DO_NOT_PAY` with reasons for the forgery, duplicate payment refused |
| PayBox developer portal | Hosted checks passed, 3 tools discovered, hosted tests of `invoice_status` and `pay_invoice` succeeded |

## 7. Run it yourself

```bash
npm install
npm run keys > keys.txt        # four throwaway wallets (gitignored)
cp .env.example .env           # fill in from keys.txt
# put the MERCHANT_SIGNER and MERCHANT_PAYOUT addresses in merchants.json
npm run dev
```

In a second terminal:

```bash
curl http://localhost:3000/health
npm run invoice -- 0.50 Logo design final files   # prints Invoice link + Check URL
curl -i "<Check URL>"                             # 402 + PAYMENT-REQUIRED header
```

Testnet payments (Base Sepolia, free): fund `TEST_BUYER_ADDRESS` with USDC from https://faucet.circle.com, then

```bash
npm run buy -- "<Check URL>"    # SAFE_TO_PAY + payUrl
npm run buy -- "<payUrl>"       # receipt + settlement tx
npm run buy -- "<payUrl>"       # 409: already paid
npm run forge                   # forged-invoice.json; host it on a gist (Raw URL)
npm run buy -- "$(npm run checkurl -s -- <raw gist URL>)"   # DO_NOT_PAY, 3 reasons
```

### Deploy

Any Node 22+ host. On Render: build `npm install`, start `npm start`, and set

```
NETWORK=testnet|mainnet
PUBLIC_BASE_URL=https://<service>.onrender.com
ADMIN_TOKEN=<long random string>
FEE_PAY_TO=<address that receives check fees>
UPSTASH_REDIS_REST_URL=…
UPSTASH_REDIS_REST_TOKEN=…
```

Never put merchant or buyer keys on the server.

## 8. Stack

Express 5, `@x402/express` v2 (exact scheme, USDC on Base), PayAI facilitator, viem, zod, Upstash Redis, TypeScript via tsx. Plugin: `@modelcontextprotocol/server`, esbuild, PayBox starter 1.0.2.

## 9. Roadmap

- Merchants sign with their own PayBox wallet instead of a local key.
- Per-merchant spending norms: flag invoices far above a merchant's usual amount.
- Self-service merchant registration with proof of control of the payout address.
- Multi-chain registry entries (Solana USDC through the same plugin).

## 10. Repository layout

```
src/            server: config, merchants, invoice schema, store, checks, HTML pages, app
scripts/        gen-keys, create-invoice, forge-invoice, check-url, test-buyer
plugin/         PayBox plugin source, starter toolchain, conformance scripts
merchants.json  the registry
truebill.md     the original build guide
```

Built by Godswill Idolor for the MoonPay PayBox Hackathon, Chapter 1 (October 2026).
