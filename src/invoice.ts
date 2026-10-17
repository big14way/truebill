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
