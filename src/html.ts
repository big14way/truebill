// Browser-facing pages. Agents and curl keep getting JSON; these render only when a
// browser asks for text/html. Everything interpolated goes through esc().
import type { InvoiceRecord } from "./store.js";
import { CHAIN_NAME, CHECK_PRICE, EXPLORER_TX, PUBLIC_BASE_URL } from "./config.js";

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STYLE = `
:root{--bg:#0b0f14;--card:#121923;--line:#1f2a38;--fg:#e6edf3;--mute:#8b98a9;--ok:#22c55e;--bad:#ef4444;--warn:#f59e0b;--accent:#60a5fa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 20px}a{color:var(--accent)}
h1{font-size:34px;margin:0 0 6px;letter-spacing:-.02em}h2{font-size:18px;margin:28px 0 10px}
.tag{color:var(--mute);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin:14px 0}
.row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}.row b{color:var(--mute);font-weight:500;white-space:nowrap}.row span{text-align:right;word-break:break-all}
.badge{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:600;font-size:13px;letter-spacing:.02em}
.unpaid{background:#1d2a3a;color:var(--accent)}.paid{background:#10301d;color:var(--ok)}.settling{background:#332410;color:var(--warn)}
.amount{font-size:40px;font-weight:700;letter-spacing:-.02em;margin:4px 0 2px}
code,pre{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0e141c;border:1px solid var(--line);border-radius:8px}
code{padding:2px 6px}pre{padding:14px;overflow:auto;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:500}
.mute{color:var(--mute);font-size:14px}.foot{margin-top:36px;color:var(--mute);font-size:13px}
.btn{display:inline-block;background:var(--accent);color:#06101c;font-weight:600;padding:10px 16px;border-radius:10px;text-decoration:none}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:18px;color:var(--mute);font-size:14px}.logo i{width:12px;height:12px;border-radius:3px;background:var(--ok);display:inline-block}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>
<div class="logo"><i></i> TrueBill · ${esc(CHAIN_NAME)}</div>${body}
<p class="foot">TrueBill verifies invoices before an AI agent pays them. Money only ever moves to a merchant's registered payout address through TrueBill's own x402 endpoints. <a href="${esc(PUBLIC_BASE_URL)}/">About</a></p>
</main></body></html>`;
}

export function invoicePage(rec: InvoiceRecord): string {
  const inv = rec.doc.invoice;
  const status = rec.status;
  const checkUrl = `${PUBLIC_BASE_URL}/api/check?url=${encodeURIComponent(`${PUBLIC_BASE_URL}/i/${inv.invoiceId}`)}`;
  const label = status === "paid" ? "PAID" : status === "settling" ? "SETTLING" : "UNPAID";
  return page(`Invoice ${inv.invoiceId} · ${inv.merchantName}`, `
<h1>${esc(inv.merchantName)}</h1>
<p class="tag">Invoice <code>${esc(inv.invoiceId)}</code> · issued ${esc(inv.issuedAt)}</p>
<div class="card">
  <span class="badge ${esc(status)}">${label}</span>
  <div class="amount">${esc(inv.amount)} <span class="mute" style="font-size:18px">USDC</span></div>
  <div class="mute">${esc(inv.description)}</div>
</div>
<div class="card">
  <div class="row"><b>Pay to (registered)</b><span><code>${esc(inv.payTo)}</code></span></div>
  <div class="row"><b>Network</b><span>${esc(CHAIN_NAME)} (chain ${esc(inv.chainId)})</span></div>
  <div class="row"><b>Merchant ID</b><span>${esc(inv.merchantId)}</span></div>
  <div class="row"><b>Signature (EIP-712)</b><span><code>${esc(rec.doc.signature.slice(0, 22))}…${esc(rec.doc.signature.slice(-8))}</code></span></div>
  ${status === "paid" ? `<div class="row"><b>Paid at</b><span>${esc(rec.paidAt)}</span></div>
  <div class="row"><b>Transaction</b><span>${rec.txHash ? `<a href="${esc(EXPLORER_TX + rec.txHash)}">${esc(rec.txHash.slice(0, 14))}…</a>` : "pending"}</span></div>` : ""}
</div>
<h2>For your agent</h2>
<p class="mute">Ask your agent to verify this invoice with TrueBill before paying. The check costs ${esc(CHECK_PRICE)} over x402 and returns SAFE_TO_PAY or DO_NOT_PAY with reasons.</p>
<pre>${esc(checkUrl)}</pre>
<p class="mute">Machine-readable: <a href="${esc(PUBLIC_BASE_URL)}/i/${esc(inv.invoiceId)}?format=json">invoice JSON</a> · <a href="${esc(PUBLIC_BASE_URL)}/api/invoices/${esc(inv.invoiceId)}">status JSON</a></p>`);
}

export function landingPage(merchantCount: number): string {
  return page("TrueBill · verify before your agent pays", `
<h1>Verify before your agent pays.</h1>
<p class="tag">TrueBill is the fraud check an AI agent runs before it pays an invoice. One cent per check, over x402, on ${esc(CHAIN_NAME)}.</p>
<div class="card">
<table>
<tr><th>Check</th><th>What it catches</th></tr>
<tr><td><code>document_format</code></td><td>Junk or malformed invoices</td></tr>
<tr><td><code>merchant_registered</code></td><td>A merchant TrueBill doesn't know</td></tr>
<tr><td><code>signature_valid</code></td><td>Invoices not signed with the merchant's registered key (forgeries)</td></tr>
<tr><td><code>payee_matches</code></td><td>"We changed our wallet, pay this new address" scams</td></tr>
<tr><td><code>network_matches</code></td><td>Invoices for the wrong chain</td></tr>
<tr><td><code>issued_via_truebill</code></td><td>Edited copies of real invoices</td></tr>
<tr><td><code>not_already_paid</code></td><td>Duplicate invoices and double payment</td></tr>
</table>
</div>
<h2>How an agent uses it</h2>
<div class="card">
  <div class="row"><b>1. Check</b><span><code>GET /api/check?url=&lt;invoice link&gt;</code> · ${esc(CHECK_PRICE)} via x402</span></div>
  <div class="row"><b>2. Decide</b><span>SAFE_TO_PAY with a <code>payUrl</code>, or DO_NOT_PAY with reasons</span></div>
  <div class="row"><b>3. Pay</b><span><code>GET /api/pay/&lt;invoiceId&gt;</code> · invoice amount via x402, to the registered payout address only</span></div>
  <div class="row"><b>4. Receipt</b><span><code>GET /api/invoices/&lt;invoiceId&gt;</code> · free, with the on-chain tx</span></div>
</div>
<p class="mute">Registered merchants: ${merchantCount}. Machine-readable manifest: <a href="${esc(PUBLIC_BASE_URL)}/?format=json">JSON</a>. Source: <a href="https://github.com/big14way/truebill">github.com/big14way/truebill</a>.</p>`);
}
