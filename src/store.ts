import { Redis } from "@upstash/redis";
import type { SignedInvoice } from "./invoice.js";

export type InvoiceStatus = "unpaid" | "settling" | "paid";

export type InvoiceRecord = {
  doc: SignedInvoice;
  status: InvoiceStatus;
  createdAt: string;
  paidAt?: string;
  txHash?: string | null;
  payer?: string | null;
};

export interface Store {
  get(id: string): Promise<InvoiceRecord | null>;
  put(rec: InvoiceRecord): Promise<void>;
}

class MemoryStore implements Store {
  private items = new Map<string, InvoiceRecord>();
  async get(id: string) {
    return this.items.get(id) ?? null;
  }
  async put(rec: InvoiceRecord) {
    this.items.set(rec.doc.invoice.invoiceId, rec);
  }
}

class RedisStore implements Store {
  private redis: Redis;
  constructor(redis: Redis) {
    this.redis = redis;
  }
  async get(id: string) {
    return (await this.redis.get<InvoiceRecord>(`inv:${id}`)) ?? null;
  }
  async put(rec: InvoiceRecord) {
    await this.redis.set(`inv:${rec.doc.invoice.invoiceId}`, rec);
  }
}

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const STORE_KIND = url && token ? "upstash" : "memory";
export const store: Store =
  url && token ? new RedisStore(new Redis({ url, token })) : new MemoryStore();
