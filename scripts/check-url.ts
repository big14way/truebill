import "dotenv/config";

// Usage: npm run checkurl -- <invoice link>
const invoiceUrl = process.argv[2];
if (!invoiceUrl) {
  console.error("Usage: npm run checkurl -- <invoice link>");
  process.exit(1);
}
const target = (process.env.TRUEBILL_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
console.log(`${target}/api/check?url=${encodeURIComponent(invoiceUrl)}`);
