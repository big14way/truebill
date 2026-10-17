import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Four throwaway wallets. Save ALL output to keys.txt (gitignored) or a password manager.
// The same address works on Base Sepolia AND Base mainnet.
for (const label of ["MERCHANT_SIGNER", "MERCHANT_PAYOUT", "TRUEBILL_FEE", "TEST_BUYER"]) {
  const key = generatePrivateKey();
  console.log(`${label}_KEY=${key}`);
  console.log(`${label}_ADDRESS=${privateKeyToAccount(key).address}\n`);
}
