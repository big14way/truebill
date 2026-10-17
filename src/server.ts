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
import { invoicePage, landingPage } from "./html.js";

// Browsers get HTML; agents, curl and x402 clients keep getting JSON.
const wantsHtml = (req: express.Request) =>
  req.query.format !== "json" && req.accepts(["json", "html"]) === "html";

const PAY_PATH = /^\/api\/pay\/(inv_[a-f0-9]{12})$/;

const app = express();
app.set("trust proxy", true);            // correct https:// URLs behind Render's proxy
app.set("case sensitive routing", true); // stops /API/PAY/... slipping past the paywall
app.set("strict routing", true);         // stops /api/check/ slipping past the paywall
app.use(express.json({ limit: "50kb" }));

// ───────────────────────── Free routes ─────────────────────────

app.get("/", (req, res) => {
  if (wantsHtml(req)) return res.type("html").send(landingPage(MERCHANTS.size));
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
  if (wantsHtml(req)) return res.type("html").send(invoicePage(rec));
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
