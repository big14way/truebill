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
