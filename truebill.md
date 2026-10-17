# TrueBill: Build Guide (PayBox Hackathon, Chapter 1)

**Pitch:** TrueBill is the fraud check an AI agent runs before it pays an invoice. Merchants sign invoices with their wallet key. Before paying, the agent pays TrueBill $0.01 over x402 to verify three things: the signature, the payout address, and that the invoice isn't already paid. It then pays only through TrueBill's verified link.

**Deadline:** Sat Oct 17, 8:00 PM EDT, which is **Sun Oct 18, 1:00 AM WAT**. Aim to submit by **11:00 PM WAT**.

---

## 0. Read first

### Unconfirmed points: check these, don't assume
1. **Submission format.** The details are behind registration at https://developer.paybox.sh. Read them in Phase 0. If they want a manifest, MCP contract, or form instead of plain x402 URLs, the endpoints in this guide stay the same; you only change the listing.
2. **PayBox on testnet.** The docs don't mention testnets, so this guide assumes the PayBox steps (Phase 5 onward) run on Base mainnet. Phases 1–4 are free on Base Sepolia.
3. **`use_service` in Claude.** PayBox only exposes this tool on some deployments. Phase 0 checks that your Claude connector has it. The `paybox` CLI is the fallback.
4. **Package versions.** They're pinned to versions other developers verified in October 2026. If install fails, put all `@x402/*` packages on the same (latest) version.
5. **The code hasn't been run.** Run every test step before moving to the next phase.

### Rules that matter
- Individuals only, 18+. Complete PayBox onboarding before submitting. Winners must pass KYC.
- Two required parts: a **live, working plugin** and a **demo video posted on X**.
- The terms allow disqualifying AI-generated work with no meaningful human contribution. Understand every file, customize names and copy, and be ready to explain how it works.

### Money summary
| Phase | Cost |
|---|---|
| 1–4 (local + deployed, testnet) | Free (test USDC from https://faucet.circle.com) |
| 5–7 (PayBox, mainnet) | About $3 USDC on Base in your PayBox EVM wallet; nearly all of it flows to addresses you control |

---

## 1. How it works

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

**The checks `/api/check` runs:**

| Check | What it catches |
|---|---|
| `document_format` | Junk or malformed invoices |
| `merchant_registered` | A merchant TrueBill doesn't know |
| `signature_valid` | Invoices not signed by the merchant's registered key (forgeries) |
| `payee_matches` | "We changed our wallet, pay this new address" scams |
| `network_matches` | Invoices for the wrong chain |
| `issued_via_truebill` | Edited copies of real invoices |
| `not_already_paid` | Duplicate invoices and double payment |

**Key design rule:** money only ever goes to the payout address in TrueBill's registry, never to an address or link taken from the invoice document. Even a perfect-looking fake can't redirect funds.

---

## 2. Timeline (WAT)

| Time | Phase | Done when |
|---|---|---|
| 12:00–12:30 | 0. Accounts | Registered, submission rules read, `use_service` visible in Claude |
| 12:30–13:00 | 1. Scaffold + keys | `npm install` works, keys generated |
| 13:00–15:00 | 2. Server code | Free endpoints work locally; `/api/check` returns 402 |
| 15:00–16:30 | 3. Testnet payments | Test buyer pays a check and an invoice on Base Sepolia |
| 16:30–17:30 | 4. Deploy | Same tests pass against the Render URL |
| 17:30–19:30 | 5. Mainnet + PayBox | PayBox CLI, then Claude, pays end to end |
| 19:30–21:30 | 6. Demo | Video recorded |
| 21:30–23:00 | 7. Submit | X post live, submission sent |
| 23:00–01:00 | Buffer | Don't spend it |

---

## Phase 0: Accounts (30 min)

1. Go to https://developer.paybox.sh and click **Register with PayBox**. Read the submission requirements and note anything that conflicts with this guide.
2. In the PayBox app (https://app.paybox.sh), finish onboarding (email + passkey) and **create an EVM wallet credential**. Note its address.
3. Connect PayBox to Claude by following https://docs.paybox.sh/connect/mcp. In a new Claude chat, ask: *"List the PayBox tools you can use."* Confirm **`use_service`** is in the list.
4. Create free accounts on **GitHub**, **Render** (render.com), and **Upstash** (upstash.com, for free Redis storage). Optionally, **UptimeRobot** to keep the server awake.
5. Run `node -v` and confirm it's **22 or higher**.

---

## Phase 1: Scaffold and keys (30 min)

```bash
mkdir truebill && cd truebill
git init
npm init -y
npm pkg set type=module
npm install express@5.1.0 viem@2.57.2 zod dotenv tsx @upstash/redis @payai/facilitator@2.4.5 @x402/core@2.27.0 @x402/evm@2.27.0 @x402/express@2.27.0 @x402/fetch@2.27.0
npm install -D typescript @types/express @types/node
mkdir src scripts
```

If any `@x402/*` version fails to install, install all four `@x402/*` packages at the same latest version.

Open `package.json` and set the `scripts` block to:

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "start": "tsx src/server.ts",
  "keys": "tsx scripts/gen-keys.ts",
  "invoice": "tsx scripts/create-invoice.ts",
  "forge": "tsx scripts/forge-invoice.ts",
  "checkurl": "tsx scripts/check-url.ts",
  "buy": "tsx scripts/test-buyer.ts",
  "typecheck": "tsc --noEmit"
},
"engines": { "node": ">=22" }
```

Add a `.gitignore`:

```
node_modules
.env
keys.txt
forged-invoice.json
```

Add a `tsconfig.json`. It's optional: `tsx` runs TypeScript without type-checking, and `npm run typecheck` is only a nice-to-have.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true
  },
  "include": ["src", "scripts"]
}
```

### `scripts/gen-keys.ts`

```ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Four throwaway wallets. Save ALL output to keys.txt (gitignored) or a password manager.
// The same address works on Base Sepolia AND Base mainnet.
for (const label of ["MERCHANT_SIGNER", "MERCHANT_PAYOUT", "TRUEBILL_FEE", "TEST_BUYER"]) {
  const key = generatePrivateKey();
  console.log(`${label}_KEY=${key}`);
  console.log(`${label}_ADDRESS=${privateKeyToAccount(key).address}\n`);
}
```

Run `npm run keys > keys.txt` and open `keys.txt`.

- **MERCHANT_PAYOUT** and **TRUEBILL_FEE** receive real USDC later. Keep their keys so you can import them into a wallet app (MetaMask, Rabby, etc.) and withdraw. Alternatively, use addresses from a wallet you already own.
- **MERCHANT_SIGNER** only signs invoices and never holds money.
- **TEST_BUYER** is for testnet only.

### `merchants.json` (project root)

Paste in the addresses from `keys.txt`:

```json
[
  {
    "merchantId": "ada-studio",
    "name": "Ada Studio",
    "signer": "0xPASTE_MERCHANT_SIGNER_ADDRESS",
    "payout": "0xPASTE_MERCHANT_PAYOUT_ADDRESS"
  }
]
```

### `.env` (project root, never committed)

```
# --- server ---
NETWORK=testnet
PUBLIC_BASE_URL=http://localhost:3000
ADMIN_TOKEN=paste-a-long-random-string-here
FEE_PAY_TO=0xPASTE_TRUEBILL_FEE_ADDRESS
MAX_INVOICE_USD=100
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# --- scripts only (NEVER put these on Render) ---
TRUEBILL_URL=http://localhost:3000
MERCHANT_ID=ada-studio
MERCHANT_NAME="Ada Studio"
MERCHANT_SIGNER_KEY=0xPASTE_MERCHANT_SIGNER_KEY
MERCHANT_PAYOUT_ADDRESS=0xPASTE_MERCHANT_PAYOUT_ADDRESS
TEST_BUYER_KEY=0xPASTE_TEST_BUYER_KEY
```

`MERCHANT_NAME` must exactly match `"name"` in `merchants.json`. Leaving the Upstash values empty is fine locally; the server then stores data in memory.

---

## Phase 2: Server code (2 hours)

### `src/config.ts`

```ts
import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
export const CHAIN_ID = NETWORK === "mainnet" ? 8453 : 84532;
export const CAIP2 = NETWORK === "mainnet" ? "eip155:8453" : "eip155:84532";
export const CHAIN_NAME = NETWORK === "mainnet" ? "Base" : "Base Sepolia";
export const EXPLORER_TX =
  NETWORK === "mainnet" ? "https://basescan.org/tx/" : "https://sepolia.basescan.org/tx/";

export const PUBLIC_BASE_URL = required("PUBLIC_BASE_URL").replace(/\/+$/, "");
export const ADMIN_TOKEN = required("ADMIN_TOKEN");
export const FEE_PAY_TO = required("FEE_PAY_TO");
export const CHECK_PRICE = process.env.CHECK_PRICE || "$0.01";
export const MAX_INVOICE_USD = Number(process.env.MAX_INVOICE_USD || "100");
export const PORT = Number(process.env.PORT || "3000");
```

### `src/merchants.ts`

```ts
import { readFileSync } from "node:fs";
import { getAddress } from "viem";

export type Merchant = {
  merchantId: string;
  name: string;
  signer: string;
  payout: string;
};

const raw = JSON.parse(
  readFileSync(new URL("../merchants.json", import.meta.url), "utf8"),
) as Merchant[];

// getAddress() validates each address and throws at startup if one is malformed.
export const MERCHANTS = new Map<string, Merchant>(
  raw.map((m) => [
    m.merchantId,
    { ...m, signer: getAddress(m.signer), payout: getAddress(m.payout) },
  ]),
);

export function getMerchant(id: string): Merchant | undefined {
  return MERCHANTS.get(id);
}
```

### `src/invoice.ts` (shared by the server and the scripts; must not import config.ts)

```ts
import { randomBytes } from "node:crypto";
import { recoverTypedDataAddress } from "viem";
import { z } from "zod";

// EIP-712 schema. The field ORDER matters: never change it after you start issuing invoices.
export const INVOICE_TYPES = {
  Invoice: [
    { name: "invoiceId", type: "string" },
    { name: "merchantId", type: "string" },
    { name: "merchantName", type: "string" },
    { name: "payTo", type: "address" },
    { name: "amount", type: "string" },
    { name: "currency", type: "string" },
    { name: "chainId", type: "string" },
    { name: "description", type: "string" },
    { name: "issuedAt", type: "string" },
  ],
} as const;

export function invoiceDomain(chainId: number) {
  return { name: "TrueBill", version: "1", chainId };
}

export const InvoiceSchema = z.object({
  invoiceId: z.string().regex(/^inv_[a-f0-9]{12}$/),
  merchantId: z.string().min(1).max(64),
  merchantName: z.string().min(1).max(100),
  payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/), // e.g. "0.50"
  currency: z.literal("USDC"),
  chainId: z.string().regex(/^\d+$/),
  description: z.string().max(200),
  issuedAt: z.string().min(1),
});

export const SignedInvoiceSchema = z.object({
  version: z.literal("truebill/1"),
  invoice: InvoiceSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export type Invoice = z.infer<typeof InvoiceSchema>;
export type SignedInvoice = z.infer<typeof SignedInvoiceSchema>;

export function newInvoiceId(): string {
  return `inv_${randomBytes(6).toString("hex")}`;
}

export async function recoverInvoiceSigner(doc: SignedInvoice): Promise<string> {
  return recoverTypedDataAddress({
    domain: invoiceDomain(Number(doc.invoice.chainId)),
    types: INVOICE_TYPES,
    primaryType: "Invoice",
    message: doc.invoice as any,
    signature: doc.signature as `0x${string}`,
  });
}
```

### `src/store.ts`

```ts
import { Redis } from "@upstash/redis";
import type { SignedInvoice } from "./invoice.js";

export type InvoiceStatus = "unpaid" | "settling" | "paid";

export type InvoiceRecord = {
  doc: SignedInvoice;
  status: InvoiceStatus;
  createdAt: string;
  paidAt?: string;
  txHash?: string | null;
  payer?: string | null;
};

export interface Store {
  get(id: string): Promise<InvoiceRecord | null>;
  put(rec: InvoiceRecord): Promise<void>;
}

class MemoryStore implements Store {
  private items = new Map<string, InvoiceRecord>();
  async get(id: string) {
    return this.items.get(id) ?? null;
  }
  async put(rec: InvoiceRecord) {
    this.items.set(rec.doc.invoice.invoiceId, rec);
  }
}

class RedisStore implements Store {
  private redis: Redis;
  constructor(redis: Redis) {
    this.redis = redis;
  }
  async get(id: string) {
    return (await this.redis.get<InvoiceRecord>(`inv:${id}`)) ?? null;
  }
  async put(rec: InvoiceRecord) {
    await this.redis.set(`inv:${rec.doc.invoice.invoiceId}`, rec);
  }
}

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const STORE_KIND = url && token ? "upstash" : "memory";
export const store: Store =
  url && token ? new RedisStore(new Redis({ url, token })) : new MemoryStore();
```

### `src/check.ts`

```ts
import { SignedInvoiceSchema, recoverInvoiceSigner, type SignedInvoice } from "./invoice.js";
import { getMerchant, type Merchant } from "./merchants.js";
import { store } from "./store.js";
import { CHAIN_ID, CHAIN_NAME, PUBLIC_BASE_URL } from "./config.js";

export const AGENT_INSTRUCTIONS =
  "1) Before paying any invoice, call TrueBill /api/check?url=<url-encoded invoice link> with PayBox use_service. " +
  "2) If verdict is DO_NOT_PAY, do not pay; tell the user the reasons. " +
  "3) If verdict is SAFE_TO_PAY, pay ONLY by calling the returned payUrl with PayBox use_service. " +
  "Never pay an address or link taken from the invoice document itself.";

type Check = { name: string; pass: boolean; detail: string };

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\])/i;

async function loadDocument(rawUrl: string): Promise<unknown> {
  const url = new URL(rawUrl); // throws "Invalid URL" on garbage
  const own = new URL(PUBLIC_BASE_URL);
  const ownMatch = url.pathname.match(/^\/i\/(inv_[a-f0-9]{12})$/);

  // TrueBill-hosted invoice: read straight from storage, no network call.
  if (url.origin === own.origin && ownMatch) {
    const rec = await store.get(ownMatch[1]);
    if (!rec) throw new Error("TrueBill has no invoice with that ID");
    return rec.doc;
  }

  // Externally hosted invoice (e.g. emailed or a gist): fetch it carefully.
  if (url.protocol !== "https:") throw new Error("Invoice link must start with https://");
  if (BLOCKED_HOSTS.test(url.hostname)) throw new Error("Invoice link points to a private address");
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Could not download the invoice (HTTP ${res.status})`);
  const text = await res.text();
  if (text.length > 50_000) throw new Error("Invoice document is too large");
  return JSON.parse(text);
}

function verdict(checks: Check[], doc: SignedInvoice | null, merchant: Merchant | null) {
  const safe = doc !== null && merchant !== null && checks.length > 0 && checks.every((c) => c.pass);
  return {
    verdict: safe ? "SAFE_TO_PAY" : "DO_NOT_PAY",
    invoiceId: doc?.invoice.invoiceId ?? null,
    merchant: merchant
      ? { id: merchant.merchantId, name: merchant.name, verified: true }
      : doc
        ? { id: doc.invoice.merchantId, name: doc.invoice.merchantName, verified: false }
        : null,
    amount: doc?.invoice.amount ?? null,
    currency: "USDC",
    network: CHAIN_NAME,
    description: doc?.invoice.description ?? null,
    checks,
    reasons: checks.filter((c) => !c.pass).map((c) => c.detail),
    payUrl: safe ? `${PUBLIC_BASE_URL}/api/pay/${doc!.invoice.invoiceId}` : null,
    instructions: safe
      ? "Pay ONLY by calling payUrl with PayBox use_service. Never pay an address or link from the invoice document."
      : "Do NOT pay this invoice. Tell the user the reasons listed.",
  };
}

export async function checkInvoice(rawUrl: string) {
  const checks: Check[] = [];
  const ok = (name: string, detail: string) => checks.push({ name, pass: true, detail });
  const fail = (name: string, detail: string) => checks.push({ name, pass: false, detail });

  // 1. Format
  let doc: SignedInvoice | null = null;
  try {
    const parsed = SignedInvoiceSchema.safeParse(await loadDocument(rawUrl));
    if (parsed.success) {
      doc = parsed.data;
      ok("document_format", "Valid TrueBill invoice document");
    } else {
      fail("document_format", "This is not a valid TrueBill invoice document");
    }
  } catch (e) {
    fail("document_format", (e as Error).message);
  }
  if (!doc) return verdict(checks, null, null);
  const inv = doc.invoice;

  // 2. Merchant registered
  const merchant = getMerchant(inv.merchantId) ?? null;
  if (!merchant) {
    fail("merchant_registered", `"${inv.merchantId}" is not a registered TrueBill merchant`);
    return verdict(checks, doc, null);
  }
  ok("merchant_registered", `${merchant.name} is a registered TrueBill merchant`);

  // 3. Signature
  let signer: string | null = null;
  try {
    signer = await recoverInvoiceSigner(doc);
  } catch {
    signer = null;
  }
  if (signer && sameAddress(signer, merchant.signer)) {
    ok("signature_valid", `Signed with ${merchant.name}'s registered key`);
  } else {
    fail(
      "signature_valid",
      `NOT signed with ${merchant.name}'s registered key${signer ? ` (signed by ${signer})` : ""}`,
    );
  }

  // 4. Payee
  if (sameAddress(inv.payTo, merchant.payout)) {
    ok("payee_matches", `Pays ${merchant.name}'s registered payout address`);
  } else {
    fail(
      "payee_matches",
      `Payout address ${inv.payTo} is NOT ${merchant.name}'s registered address ${merchant.payout}`,
    );
  }

  // 5. Network
  if (inv.chainId === String(CHAIN_ID)) {
    ok("network_matches", `Settles on ${CHAIN_NAME}`);
  } else {
    fail("network_matches", `Invoice is for chain ${inv.chainId}; TrueBill settles on ${CHAIN_NAME}`);
  }

  // 6. Issued through TrueBill (identical document on record)
  const rec = await store.get(inv.invoiceId);
  if (rec && rec.doc.signature.toLowerCase() === doc.signature.toLowerCase()) {
    ok("issued_via_truebill", "This exact invoice was issued through TrueBill");
  } else {
    fail("issued_via_truebill", "TrueBill has no record of this exact invoice");
  }

  // 7. Not already paid
  if (rec) {
    if (rec.status === "unpaid") ok("not_already_paid", "Not paid yet");
    else if (rec.status === "paid")
      fail("not_already_paid", `Already paid at ${rec.paidAt}${rec.txHash ? ` (tx ${rec.txHash})` : ""}`);
    else fail("not_already_paid", "A payment for this invoice is already in progress");
  }

  return verdict(checks, doc, merchant);
}
```

### `src/server.ts`

```ts
import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator } from "@payai/facilitator";
import {
  ADMIN_TOKEN, CAIP2, CHAIN_ID, CHAIN_NAME, CHECK_PRICE, EXPLORER_TX,
  FEE_PAY_TO, MAX_INVOICE_USD, PORT, PUBLIC_BASE_URL,
} from "./config.js";
import { SignedInvoiceSchema, recoverInvoiceSigner } from "./invoice.js";
import { MERCHANTS, getMerchant } from "./merchants.js";
import { store, STORE_KIND, type InvoiceRecord } from "./store.js";
import { checkInvoice, AGENT_INSTRUCTIONS } from "./check.js";

const PAY_PATH = /^\/api\/pay\/(inv_[a-f0-9]{12})$/;

const app = express();
app.set("trust proxy", true);            // correct https:// URLs behind Render's proxy
app.set("case sensitive routing", true); // stops /API/PAY/... slipping past the paywall
app.set("strict routing", true);         // stops /api/check/ slipping past the paywall
app.use(express.json({ limit: "50kb" }));

// ───────────────────────── Free routes ─────────────────────────

app.get("/", (_req, res) => {
  res.json({
    name: "TrueBill",
    tagline: "Verify an invoice before your agent pays it.",
    network: CHAIN_NAME,
    endpoints: {
      check: {
        method: "GET",
        url: `${PUBLIC_BASE_URL}/api/check?url=<url-encoded invoice link>`,
        price: CHECK_PRICE,
        payment: "x402",
      },
      pay: {
        method: "GET",
        url: `${PUBLIC_BASE_URL}/api/pay/<invoiceId>`,
        price: "the invoice amount",
        payment: "x402",
        note: "Only call the payUrl returned by /api/check",
      },
      status: { method: "GET", url: `${PUBLIC_BASE_URL}/api/invoices/<invoiceId>`, price: "free" },
    },
    agentInstructions: AGENT_INSTRUCTIONS,
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, network: CHAIN_NAME });
});

// Public invoice document (what the merchant sends to the customer)
app.get("/i/:id", async (req, res) => {
  const rec = await store.get(String(req.params.id));
  if (!rec) return res.status(404).json({ error: "Invoice not found" });
  res.json(rec.doc);
});

// Public status + on-chain receipt
app.get("/api/invoices/:id", async (req, res) => {
  const rec = await store.get(String(req.params.id));
  if (!rec) return res.status(404).json({ error: "Invoice not found" });
  const inv = rec.doc.invoice;
  res.json({
    invoiceId: inv.invoiceId,
    merchant: inv.merchantName,
    description: inv.description,
    amount: inv.amount,
    currency: inv.currency,
    network: CHAIN_NAME,
    status: rec.status,
    paidAt: rec.paidAt ?? null,
    txHash: rec.txHash ?? null,
    explorer: rec.txHash ? `${EXPLORER_TX}${rec.txHash}` : null,
  });
});

// Merchant registers a signed invoice (admin-only; the merchant's signing key never touches this server)
app.post("/api/invoices", async (req, res) => {
  if (req.header("authorization") !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parsed = SignedInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid invoice document", issues: parsed.error.issues });
  }
  const doc = parsed.data;
  const inv = doc.invoice;
  const merchant = getMerchant(inv.merchantId);
  if (!merchant) return res.status(400).json({ error: "Unknown merchant" });
  if (inv.merchantName !== merchant.name) {
    return res.status(400).json({ error: `merchantName must be "${merchant.name}"` });
  }
  if (inv.chainId !== String(CHAIN_ID)) {
    return res.status(400).json({ error: `Wrong chain: server runs on ${CHAIN_NAME} (${CHAIN_ID})` });
  }
  const amount = Number(inv.amount);
  if (!(amount > 0) || amount > MAX_INVOICE_USD) {
    return res.status(400).json({ error: `Amount must be > 0 and <= ${MAX_INVOICE_USD}` });
  }
  if (inv.payTo.toLowerCase() !== merchant.payout.toLowerCase()) {
    return res.status(400).json({ error: "payTo must be the merchant's registered payout address" });
  }
  let signer: string | null = null;
  try {
    signer = await recoverInvoiceSigner(doc);
  } catch {
    signer = null;
  }
  if (!signer || signer.toLowerCase() !== merchant.signer.toLowerCase()) {
    return res.status(400).json({ error: "Signature does not match the merchant's registered signer" });
  }
  if (await store.get(inv.invoiceId)) {
    return res.status(409).json({ error: "Invoice ID already exists" });
  }
  await store.put({ doc, status: "unpaid", createdAt: new Date().toISOString() });
  res.status(201).json({ invoiceId: inv.invoiceId, invoiceUrl: `${PUBLIC_BASE_URL}/i/${inv.invoiceId}` });
});

// ─────────────── Guards that run BEFORE the paywall ───────────────
// Express app.get() also answers HEAD requests, which the x402 "GET ..." routes don't cover.
// These guards make sure nothing except a plain GET can reach the paid handlers.

app.use("/api/check", (req, res, next) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET" });
  if (typeof req.query.url !== "string" || req.query.url.length === 0) {
    return res.status(400).json({ error: "Missing ?url=<invoice link>" });
  }
  next();
});

app.use("/api/pay", async (req, res, next) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET" });
  const match = req.originalUrl.split("?")[0].match(PAY_PATH);
  if (!match) return res.status(404).json({ error: "Unknown invoice" });
  const rec = await store.get(match[1]);
  if (!rec) return res.status(404).json({ error: "Unknown invoice" });
  if (rec.status !== "unpaid") {
    return res.status(409).json({ error: `Invoice is ${rec.status}`, txHash: rec.txHash ?? null });
  }
  next();
});

// ───────────────────────── x402 paywall ─────────────────────────

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient(facilitator)).register(
  "eip155:*", // covers Base Sepolia and Base mainnet
  new ExactEvmScheme(),
);

type PriceContext = { adapter: { getPath(): string } };

async function invoiceFromContext(ctx: PriceContext): Promise<InvoiceRecord> {
  const match = ctx.adapter.getPath().split("?")[0].match(PAY_PATH);
  const rec = match ? await store.get(match[1]) : null;
  if (!rec) throw new Error("Unknown invoice");
  return rec;
}

app.use(
  paymentMiddleware(
    {
      "GET /api/check": {
        accepts: [{ scheme: "exact", price: CHECK_PRICE, network: CAIP2, payTo: FEE_PAY_TO }],
        description: "TrueBill: verify an invoice (signature, payee, duplicate) before paying it",
        mimeType: "application/json",
      },
      "GET /api/pay/*": {
        accepts: [
          {
            scheme: "exact",
            network: CAIP2,
            // Price = the signed invoice amount
            price: async (ctx: PriceContext) => `$${(await invoiceFromContext(ctx)).doc.invoice.amount}`,
            // Recipient = the merchant's REGISTERED payout address (never taken from the document)
            payTo: async (ctx: PriceContext) => {
              const rec = await invoiceFromContext(ctx);
              return getMerchant(rec.doc.invoice.merchantId)!.payout;
            },
          },
        ],
        description: "TrueBill: pay a verified invoice",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

// ───────────────────────── Paid handlers ─────────────────────────

app.get("/api/check", async (req, res) => {
  res.json(await checkInvoice(String(req.query.url)));
});

function decodeSettlement(header: unknown): { transaction?: string; payer?: string } | null {
  if (typeof header !== "string") return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

app.get("/api/pay/:id", async (req, res) => {
  // Defence in depth: the paywall must have seen a payment header.
  if (!req.header("payment-signature") && !req.header("x-payment")) {
    return res.status(402).json({ error: "Payment required" });
  }
  const id = String(req.params.id);
  const rec = await store.get(id);
  if (!rec || rec.status !== "unpaid") {
    return res.status(409).json({ error: "Invoice is not payable" });
  }
  rec.status = "settling";
  await store.put(rec);

  // After the response is sent, record the final outcome (+ tx hash if the settlement header is present).
  res.on("finish", async () => {
    try {
      const latest = await store.get(id);
      if (!latest) return;
      if (res.statusCode < 400) {
        const settle = decodeSettlement(
          res.getHeader("payment-response") ?? res.getHeader("x-payment-response"),
        );
        latest.status = "paid";
        latest.paidAt = new Date().toISOString();
        latest.txHash = settle?.transaction ?? null;
        latest.payer = settle?.payer ?? null;
      } else {
        latest.status = "unpaid";
      }
      await store.put(latest);
    } catch (err) {
      console.error("Failed to record payment outcome", err);
    }
  });

  const inv = rec.doc.invoice;
  res.json({
    status: "paid",
    receipt: {
      invoiceId: inv.invoiceId,
      merchant: inv.merchantName,
      description: inv.description,
      amount: inv.amount,
      currency: inv.currency,
      network: CHAIN_NAME,
      paidAt: new Date().toISOString(),
      statusUrl: `${PUBLIC_BASE_URL}/api/invoices/${inv.invoiceId}`,
    },
    message: `Paid ${inv.amount} USDC to ${inv.merchantName}. The on-chain transaction appears at statusUrl.`,
  });
});

// ───────────────────────── Errors + start ─────────────────────────

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal error" });
});

app.listen(PORT, () => {
  console.log(
    `TrueBill listening on ${PORT} | public ${PUBLIC_BASE_URL} | ${CHAIN_NAME} (${CAIP2}) | store=${STORE_KIND} | merchants=${MERCHANTS.size}`,
  );
});
```

### `scripts/create-invoice.ts` (runs on the merchant's machine)

```ts
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { INVOICE_TYPES, invoiceDomain, newInvoiceId } from "../src/invoice.js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
  return value;
}

// Usage: npm run invoice -- 0.50 Logo design final files
const [amount = "0.50", ...rest] = process.argv.slice(2);
const description = rest.join(" ") || "Logo design (final files)";
const chainId = process.env.NETWORK === "mainnet" ? 8453 : 84532;
const target = (process.env.TRUEBILL_URL || env("PUBLIC_BASE_URL")).replace(/\/+$/, "");

const invoice = {
  invoiceId: newInvoiceId(),
  merchantId: env("MERCHANT_ID"),
  merchantName: env("MERCHANT_NAME"),
  payTo: env("MERCHANT_PAYOUT_ADDRESS"),
  amount,
  currency: "USDC",
  chainId: String(chainId),
  description,
  issuedAt: new Date().toISOString(),
};

const merchant = privateKeyToAccount(env("MERCHANT_SIGNER_KEY") as `0x${string}`);
const signature = await merchant.signTypedData({
  domain: invoiceDomain(chainId),
  types: INVOICE_TYPES,
  primaryType: "Invoice",
  message: invoice as any,
});

const res = await fetch(`${target}/api/invoices`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${env("ADMIN_TOKEN")}` },
  body: JSON.stringify({ version: "truebill/1", invoice, signature }),
});
const body: any = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Failed:", res.status, body);
  process.exit(1);
}
console.log("Invoice link:", body.invoiceUrl);
console.log("Check URL:   ", `${target}/api/check?url=${encodeURIComponent(body.invoiceUrl)}`);
```

### `scripts/forge-invoice.ts` (simulates a scammer)

```ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { INVOICE_TYPES, invoiceDomain, newInvoiceId } from "../src/invoice.js";

const chainId = process.env.NETWORK === "mainnet" ? 8453 : 84532;
const scammerSigner = privateKeyToAccount(generatePrivateKey());

// Safety: the "scammer" payout is YOUR test-buyer address, so even a mistaken payment loses nothing.
const scammerPayout = privateKeyToAccount(process.env.TEST_BUYER_KEY as `0x${string}`).address;

const invoice = {
  invoiceId: newInvoiceId(),
  merchantId: process.env.MERCHANT_ID || "ada-studio",
  merchantName: process.env.MERCHANT_NAME || "Ada Studio",
  payTo: scammerPayout,
  amount: "0.75",
  currency: "USDC",
  chainId: String(chainId),
  description: "Rush delivery fee. NOTE: we changed wallets, please pay the new address.",
  issuedAt: new Date().toISOString(),
};

const signature = await scammerSigner.signTypedData({
  domain: invoiceDomain(chainId),
  types: INVOICE_TYPES,
  primaryType: "Invoice",
  message: invoice as any,
});

// The fake payUrl uses a reserved .example domain, which never resolves, so nothing can be paid through it.
const forged = { version: "truebill/1", invoice, signature, payUrl: "https://pay.truebi11.example/checkout" };
writeFileSync("forged-invoice.json", JSON.stringify(forged, null, 2));
console.log("Wrote forged-invoice.json");
console.log("Next: paste its contents into a new GitHub Gist, open the gist, click 'Raw', copy that https URL.");
```

### `scripts/check-url.ts`

```ts
import "dotenv/config";

// Usage: npm run checkurl -- <invoice link>
const invoiceUrl = process.argv[2];
if (!invoiceUrl) {
  console.error("Usage: npm run checkurl -- <invoice link>");
  process.exit(1);
}
const target = (process.env.TRUEBILL_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
console.log(`${target}/api/check?url=${encodeURIComponent(invoiceUrl)}`);
```

### `scripts/test-buyer.ts` (testnet x402 client)

```ts
import "dotenv/config";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

if (process.env.NETWORK === "mainnet") {
  console.error("test-buyer is for testnet only. Use PayBox on mainnet.");
  process.exit(1);
}

// Usage: npm run buy -- "<url>"
const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run buy -- "<url>"');
  process.exit(1);
}

const signer = privateKeyToAccount(process.env.TEST_BUYER_KEY as `0x${string}`);
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment(url, { method: "GET" });
console.log("HTTP", res.status);
const settlement = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
if (settlement) {
  console.log("Settlement:", JSON.parse(Buffer.from(settlement, "base64").toString("utf8")));
}
const text = await res.text();
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
```

### Test 2: free endpoints, local (no money)

Windows: use PowerShell or Git Bash, and type `curl.exe` instead of `curl`.

```bash
npm run dev
# in a second terminal:
curl http://localhost:3000/health
npm run invoice -- 0.50 Logo design final files     # prints Invoice link + Check URL
curl http://localhost:3000/i/<invoiceId>             # signed invoice JSON
curl -i "<Check URL printed above>"                  # expect: HTTP/1.1 402 + a PAYMENT-REQUIRED header
```

Pass criteria:
- The invoice is created (this proves signing and signature recovery agree).
- `/api/check` returns **402**.

---

## Phase 3: Testnet payments (90 min, free)

1. Fund your **TEST_BUYER address** with Base Sepolia USDC at https://faucet.circle.com (choose Base Sepolia). The Base Sepolia USDC contract is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
2. **Check the real invoice:** `npm run buy -- "<Check URL>"` should return `HTTP 200`, `"verdict": "SAFE_TO_PAY"`, and a `payUrl`.
3. **Pay it:** `npm run buy -- "<payUrl>"` should return `HTTP 200`, a receipt, and a `Settlement:` line with a transaction.
4. **Status:** `curl http://localhost:3000/api/invoices/<invoiceId>` should show `"status": "paid"` and a `txHash`.
5. **Double payment is blocked:** `npm run buy -- "<payUrl>"` again should return **409** with no payment taken.
6. **Forgery:**
   - Run `npm run forge`.
   - Paste `forged-invoice.json` into a new GitHub Gist, click **Raw**, and copy the URL.
   - Run `npm run checkurl -- <raw gist URL>`, then `npm run buy -- "<that check URL>"`.
   - It should return `"verdict": "DO_NOT_PAY"` with 3 reasons: signature, payee, and not issued via TrueBill.
7. **Re-check the paid invoice:** it should return `DO_NOT_PAY` with the reason "Already paid at …".

If all of these pass, the core product works.

---

## Phase 4: Deploy (1 hour)

1. **Upstash:** create a Redis database and copy its **REST URL** and **REST token**.
2. **GitHub:** run `git status` and confirm `.env` and `keys.txt` are **not** listed. Then commit and push.
3. **Render:** New → **Web Service** → connect the repo.
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
4. **Render environment variables** (server only, no merchant or buyer keys):
```
   NETWORK=testnet
   PUBLIC_BASE_URL=https://<your-service>.onrender.com
   ADMIN_TOKEN=<same as local .env>
   FEE_PAY_TO=<TRUEBILL_FEE address>
   UPSTASH_REDIS_REST_URL=<from Upstash>
   UPSTASH_REDIS_REST_TOKEN=<from Upstash>
   NODE_VERSION=22
```
   You only learn the exact `onrender.com` URL after the service is created. Set `PUBLIC_BASE_URL` then and redeploy. Don't set `PORT`; Render provides it.
5. **Check the logs.** Expect: `TrueBill listening ... | Base Sepolia (eip155:84532) | store=upstash | merchants=1`.
6. **Point the scripts at Render:** in your local `.env`, set `TRUEBILL_URL=https://<your-service>.onrender.com` and keep `NETWORK=testnet`. Repeat **all of Phase 3** against Render with a new invoice; the remote store is separate from your local one.
7. **Keep the server awake (optional but recommended):** free Render instances sleep when idle, and the first request after sleeping is slow. Add an UptimeRobot HTTP monitor on `https://<your-service>.onrender.com/health` every 5 minutes.

---

## Phase 5: Mainnet + PayBox (2 hours, about $3)

1. **Fund your PayBox EVM wallet with about 3 USDC on Base.** Pick one:
   - If PayBox already holds USDC on Solana, ask Claude (with PayBox): *"Bridge 3 USDC from my Solana wallet to USDC on Base in my EVM wallet."*
   - Send USDC **on the Base network** from an exchange or wallet to your PayBox EVM address. Double-check the network says Base.
   - Use PayBox's MoonPay buy link. Card checkout availability and minimum amounts vary.
   - Base mainnet USDC contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
2. **Switch the server to mainnet:** set `NETWORK=mainnet` on Render and redeploy. The logs should show `Base (eip155:8453)`. Your addresses don't change; the same addresses work on mainnet.
3. **Switch the scripts to mainnet:** set `NETWORK=mainnet` in your local `.env` (`TRUEBILL_URL` stays the Render URL). Testnet invoices now fail `network_matches`, which is expected.
   - `npm run invoice -- 0.50 Logo design final files` gives you the **real invoice link**.
   - `npm run forge`, then create a **new** gist revision or new gist and copy the new **Raw** URL. That's the **forged link**.
4. **Test with the PayBox CLI before using Claude:**
```bash
   npm install -g @paybox-sh/sdk        # if "paybox" isn't found later, use: npx @paybox-sh/sdk <command>
   paybox login
   paybox connect
   paybox --json credentials            # copy your EVM wallet's credential_id
   paybox use-service --credential <EVM_CREDENTIAL_ID> --url "<Check URL for real invoice>" --wait
   paybox use-service --credential <EVM_CREDENTIAL_ID> --url "<payUrl from the result>" --wait
```
   Then confirm two things:
   - `https://<your-service>.onrender.com/api/invoices/<id>` shows `"paid"` with a `txHash`.
   - The `explorer` link shows the USDC transfer to the Ada Studio payout address.
5. **Test in Claude** with a **fresh** invoice (each invoice can only be paid once). Use this prompt:

```
   I got two invoices from Ada Studio today:
   A) <REAL INVOICE LINK>
   B) <FORGED GIST RAW LINK>

   TrueBill (https://<your-service>.onrender.com) verifies invoices before they're paid.
   For each invoice, call https://<your-service>.onrender.com/api/check?url=<URL-encoded invoice link>
   using the PayBox use_service tool with my EVM wallet. Pay only invoices whose verdict is
   SAFE_TO_PAY, and pay them only by calling the payUrl TrueBill returns, again with use_service.
   For anything you don't pay, tell me exactly why.
```

   If Claude stumbles on URL-encoding, pre-build both check URLs with `npm run checkurl -- <link>` and paste them into the prompt instead.

**Safety rule while testing:** if PayBox ever asks you to approve a payment to an address you don't recognize, decline it.

---

## Phase 6: Demo video (60–90 seconds)

Rehearse twice using fresh invoices. Each rehearsal costs about $0.52, which goes to your own wallets.

| Time | On screen | Voiceover / caption |
|---|---|---|
| 0–8s | Title card | "AI agents are starting to pay invoices. Scammers will send them fake ones." |
| 8–18s | Terminal: `npm run invoice` | "Ada Studio signs an invoice with its wallet key." |
| 18–28s | Forged JSON (highlight "we changed wallets") | "A scammer sends a lookalike with a new payout address." |
| 28–55s | Claude: prompt → two TrueBill checks | "The agent pays TrueBill one cent per check over x402. The fake fails 3 checks. The real one passes." |
| 55–68s | PayBox passkey approval → receipt | "It pays only through TrueBill's verified link, with my passkey approval." |
| 68–78s | BaseScan: USDC arriving at Ada Studio | "The USDC lands at the merchant's registered address." |
| 78–90s | Ask to pay A again → "Already paid" | "Duplicates are blocked too. TrueBill: verify before your agent pays." |

Tips:
- Open `/health` a minute before recording so the server is awake.
- Record the screen at 1080p and add captions.
- Keep it under 90 seconds.

---

## Phase 7: Submit (by 11:00 PM WAT)

**X post (edit it into your own words):**
```
AI agents are about to pay our invoices. Scammers are about to send them fake ones.

TrueBill is a @PayBox plugin: before your agent pays, it spends $0.01 over x402 to verify the invoice (merchant signature, payout address, duplicates), then pays only through a verified link.

Built for the @moonpay PayBox Hackathon.
Live: https://<your-service>.onrender.com
Code: https://github.com/<you>/truebill
[attach video]
```

**Checklist:**
- [ ] Live URL works: `/` returns the manifest; `/api/check` returns 402 when unpaid
- [ ] Render is on `NETWORK=mainnet` and UptimeRobot is pinging `/health`
- [ ] At least one real paid invoice is visible on BaseScan
- [ ] Repo is public with a README (template below); no keys committed
- [ ] Demo video is posted on X and the post link is copied
- [ ] Submitted through the official process from developer.paybox.sh with the live URL, repo, and X link
- [ ] You can explain every file in your own words

**README template for the repo:**
```
# TrueBill: verify before your agent pays

Invoice fraud ("we changed our bank details") is one of the oldest scams. Once agents pay invoices
automatically, it gets worse. TrueBill is an x402-native PayBox plugin:

1. Merchants sign invoices (EIP-712) with a registered key.
2. Before paying, an agent calls GET /api/check?url=<invoice> ($0.01 via x402). TrueBill checks the
   signature, payout address, network, issuance and payment status.
3. If safe, the agent pays GET /api/pay/<id> via x402. Funds go only to the merchant's registered
   payout address, never to an address taken from the invoice itself.

Stack: Express, @x402/express (v2, exact scheme, USDC on Base), PayAI facilitator, viem, Upstash Redis.
Works with PayBox's use_service tool in Claude or the paybox CLI.
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `RouteConfigurationError ... No scheme implementation registered` | Make sure the server registers `"eip155:*"` (it does in this guide) and `NETWORK` is `testnet` or `mainnet` |
| 402 response shows `http://` URLs on Render | Keep `app.set("trust proxy", true)`; set `PUBLIC_BASE_URL` to the `https://` URL |
| Dynamic `payTo` function errors at startup | Replace `payTo: async (ctx) => ...` with the payout address from `merchants.json` (one merchant only) |
| PayBox error about a "plain EOA" | PayBox's x402 needs a plain (non-delegated) wallet. Follow PayBox's prompt to undelegate, or create a fresh EVM wallet credential |
| `free_tier_exhausted` (HTTP 403) from the facilitator | Very unlikely at demo volume; create a PayAI merchant key at merchant.payai.network |
| Claude uses web fetch instead of PayBox | Say explicitly: "use the PayBox use_service tool" |
| `use_service` missing in Claude | Use the CLI path from Phase 5 step 4 for the demo, and say so in the video |
| Invoice stuck in `"settling"` | Create a new invoice for the demo; don't try to pay the stuck one again |
| First request times out | Server was asleep; open `/health` first; set up UptimeRobot |
| npm version conflicts | Put every `@x402/*` package on the same version |

---

## Stretch goals (only if everything above is done before 21:00)
1. **Merchant signs with their PayBox wallet** instead of a local key. Use `paybox sign --credential <id> --intent '{"op":"typedData","typedData":{...}}'`, then put the returned signature into the invoice. Check the exact `typedData` shape the CLI expects before relying on it, and register the PayBox wallet address as the merchant's `signer` in `merchants.json`.
2. **Invoice page:** render a simple HTML page at `/i/:id` when a browser requests it (`req.accepts("html")`). Keep the JSON response for agents.
3. **Amount guard:** add a per-merchant "usual maximum" and flag invoices above it.