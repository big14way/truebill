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
