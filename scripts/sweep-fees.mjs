// Sweep all USDC from the old TRUEBILL_FEE wallet to a destination address on Base mainnet.
// Usage (run yourself):  node scripts/sweep-fees.mjs 0xYourWallet
// Reads TRUEBILL_FEE_KEY from keys.txt. The fee wallet needs a little ETH on Base for gas.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, erc20Abi, formatUnits, formatEther, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const to = process.argv[2];
if (!to || !isAddress(to)) { console.error("usage: node scripts/sweep-fees.mjs 0xDestination"); process.exit(1); }
const key = readFileSync("keys.txt", "utf8").match(/^TRUEBILL_FEE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
if (!key) { console.error("TRUEBILL_FEE_KEY not found in keys.txt"); process.exit(1); }

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: base, transport: http() });
const wallet = createWalletClient({ account, chain: base, transport: http() });

const [eth, bal] = await Promise.all([
  pub.getBalance({ address: account.address }),
  pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
]);
console.log(`from ${account.address}: ${formatUnits(bal, 6)} USDC, ${formatEther(eth)} ETH`);
if (bal === 0n) { console.log("nothing to sweep"); process.exit(0); }
if (eth === 0n) { console.error("no ETH for gas: send ~0.00005 ETH on Base to the address above, then rerun"); process.exit(1); }

const hash = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [to, bal] });
console.log("tx", `https://basescan.org/tx/${hash}`);
const r = await pub.waitForTransactionReceipt({ hash });
console.log(r.status === "success" ? `sent ${formatUnits(bal, 6)} USDC to ${to}` : "transaction reverted");
