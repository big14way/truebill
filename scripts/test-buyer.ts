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
