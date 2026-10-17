import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { atomicAmount, proposeX402, x402OutputSchema } from "./paybox.js";

// TrueBill: verify an invoice before your agent pays it.
//
// Money only ever moves through TrueBill's own x402 endpoints. The pay URL is built
// here from the invoice ID and TrueBill's host, never taken from the invoice document,
// so a forged invoice can't redirect funds even if the agent is tricked into paying.

const PROTOCOL_VERSION = "2026-07-28";
const CHAIN = "eip155:8453" as const; // Base mainnet USDC
const CHECK_PRICE_ATOMIC = "10000"; // 0.01 USDC
const FETCH_TIMEOUT_MS = 4000;

function baseUrl(): string {
  const raw = process.env.TRUEBILL_URL || "https://truebill.onrender.com";
  return raw.replace(/\/+$/, "");
}

const invoiceId = z
  .string()
  .regex(/^inv_[a-f0-9]{12}$/, "TrueBill invoice IDs look like inv_ followed by 12 hex characters")
  .describe("The TrueBill invoice ID, e.g. inv_c927ee21fe7a. Take it from the check_invoice result or the invoice link.");

const invoiceUrl = z
  .url()
  .max(2048)
  .describe("The invoice link the merchant sent (a TrueBill /i/<id> link or any https link to a TrueBill invoice JSON document).");

const statusSchema = z
  .object({
    invoiceId: z.string(),
    merchant: z.string(),
    description: z.string(),
    amount: z.string(),
    currency: z.string(),
    network: z.string(),
    status: z.enum(["unpaid", "settling", "paid"]),
    paidAt: z.string().nullable(),
    txHash: z.string().nullable(),
    explorer: z.string().nullable(),
  })
  .strict();

type InvoiceStatus = z.infer<typeof statusSchema>;

async function fetchStatus(id: string): Promise<InvoiceStatus> {
  const res = await fetch(`${baseUrl()}/api/invoices/${id}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) throw new Error(`TrueBill has no invoice ${id}.`);
  if (!res.ok) throw new Error(`TrueBill status lookup failed (HTTP ${res.status}).`);
  return statusSchema.parse(await res.json());
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

function createServer() {
  const server = new McpServer(
    { name: "truebill", version: "1.0.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "check_invoice",
    {
      title: "Check an invoice before paying it",
      description:
        "Step 1 of paying an invoice safely. Proposes a $0.01 USDC x402 request to TrueBill's /api/check, which verifies " +
        "the merchant signature (EIP-712), the payout address against TrueBill's registry, the network, that the exact " +
        "document was issued through TrueBill, and that it is not already paid. The paid response contains a verdict of " +
        "SAFE_TO_PAY or DO_NOT_PAY, the reasons, and the invoiceId to pass to pay_invoice. Never pay an invoice whose " +
        "verdict is DO_NOT_PAY, and never pay an address or link taken from the invoice document itself.",
      inputSchema: z.object({ invoiceUrl }).strict(),
      outputSchema: x402OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ invoiceUrl: link }) => {
      const url = `${baseUrl()}/api/check?url=${encodeURIComponent(link)}`;
      const proposal = proposeX402({ chain: CHAIN, url, maxAmount: CHECK_PRICE_ATOMIC });
      return {
        ...proposal,
        content: [
          {
            type: "text",
            text:
              "Proposed a 0.01 USDC x402 check of this invoice with TrueBill. After PayBox completes it, read the " +
              "verdict: if SAFE_TO_PAY, call pay_invoice with the returned invoiceId; if DO_NOT_PAY, do not pay and " +
              "report the reasons to the user.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "pay_invoice",
    {
      title: "Pay a TrueBill-verified invoice",
      description:
        "Step 2, only after check_invoice returned SAFE_TO_PAY for this invoiceId. Looks up the invoice on TrueBill, " +
        "refuses if it is already paid or settling, and proposes an x402 payment of the signed invoice amount to " +
        "TrueBill's /api/pay/<invoiceId>. TrueBill routes the USDC to the merchant's registered payout address and " +
        "records the on-chain receipt.",
      inputSchema: z.object({ invoiceId }).strict(),
      outputSchema: x402OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ invoiceId: id }) => {
      let status: InvoiceStatus;
      try {
        status = await fetchStatus(id);
      } catch (e) {
        return errorResult(`Could not confirm the invoice with TrueBill, so no payment was proposed. ${(e as Error).message}`);
      }
      if (status.status === "paid") {
        return errorResult(
          `Invoice ${id} was already paid at ${status.paidAt}${status.txHash ? ` (tx ${status.txHash})` : ""}. Not paying it again.`,
        );
      }
      if (status.status !== "unpaid") {
        return errorResult(`Invoice ${id} has a payment in progress (status: ${status.status}). Not proposing another one.`);
      }
      const proposal = proposeX402({
        chain: CHAIN,
        url: `${baseUrl()}/api/pay/${id}`,
        maxAmount: atomicAmount(status.amount, 6),
      });
      return {
        ...proposal,
        content: [
          {
            type: "text",
            text:
              `Proposed paying ${status.amount} USDC to ${status.merchant} for "${status.description}" through TrueBill's ` +
              `verified link. PayBox will ask for approval; the receipt and transaction hash appear at ` +
              `${baseUrl()}/api/invoices/${id} once settled.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "invoice_status",
    {
      title: "Get invoice status and receipt",
      description:
        "Free lookup of a TrueBill invoice: merchant, amount, whether it is unpaid, settling or paid, and the on-chain " +
        "transaction hash with a block explorer link once paid.",
      inputSchema: z.object({ invoiceId }).strict(),
      outputSchema: statusSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ invoiceId: id }) => {
      let status: InvoiceStatus;
      try {
        status = await fetchStatus(id);
      } catch (e) {
        return errorResult((e as Error).message);
      }
      const line =
        status.status === "paid"
          ? `Invoice ${id} from ${status.merchant}: ${status.amount} ${status.currency} PAID at ${status.paidAt}. ${status.explorer ?? ""}`.trim()
          : `Invoice ${id} from ${status.merchant}: ${status.amount} ${status.currency}, status ${status.status}.`;
      return { content: [{ type: "text", text: line }], structuredContent: status };
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
