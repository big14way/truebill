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
