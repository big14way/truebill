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
