// In-memory storage adapter for oidc-provider and for the broker's own models
// (GatewayAccount, UpstreamLogin, AssertionJti). It implements the adapter
// interface oidc-provider documents, so a Cosmos or Firestore adapter can
// replace it without touching the callers. State is lost on restart and is not
// shared between replicas: run one replica until a shared adapter exists.

export type Payload = Record<string, unknown>;

export interface StorageAdapter {
  upsert(id: string, payload: Payload, expiresIn?: number): Promise<void>;
  find(id: string): Promise<Payload | undefined>;
  findByUid(uid: string): Promise<Payload | undefined>;
  findByUserCode(userCode: string): Promise<Payload | undefined>;
  consume(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  revokeByGrantId(grantId: string): Promise<void>;
}

export type AdapterFactory = new (name: string) => StorageAdapter;

interface Entry {
  payload: Payload;
  expiresAt?: number;
}

export interface MemoryAdapter {
  Adapter: AdapterFactory;
  // Drops expired entries; returns how many were removed.
  sweep(now?: number): number;
  size(): number;
}

export function createMemoryAdapter(): MemoryAdapter {
  const entries = new Map<string, Entry>();

  function live(key: string, now = Date.now()): Entry | undefined {
    const e = entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== undefined && e.expiresAt <= now) {
      entries.delete(key);
      return undefined;
    }
    return e;
  }

  function sweep(now = Date.now()): number {
    let removed = 0;
    for (const [key, e] of entries) {
      if (e.expiresAt !== undefined && e.expiresAt <= now) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  class Adapter implements StorageAdapter {
    constructor(private readonly name: string) {}

    private key(id: string): string {
      return `${this.name}:${id}`;
    }

    private scan(field: string, value: string): Payload | undefined {
      const prefix = `${this.name}:`;
      const now = Date.now();
      for (const [key, e] of entries) {
        if (!key.startsWith(prefix)) continue;
        if (e.expiresAt !== undefined && e.expiresAt <= now) continue;
        if (e.payload[field] === value) return structuredClone(e.payload);
      }
      return undefined;
    }

    async upsert(id: string, payload: Payload, expiresIn?: number): Promise<void> {
      entries.set(this.key(id), {
        payload: structuredClone(payload),
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
      });
    }

    async find(id: string): Promise<Payload | undefined> {
      const e = live(this.key(id));
      return e ? structuredClone(e.payload) : undefined;
    }

    async findByUid(uid: string): Promise<Payload | undefined> {
      return this.scan("uid", uid);
    }

    async findByUserCode(userCode: string): Promise<Payload | undefined> {
      return this.scan("userCode", userCode);
    }

    async consume(id: string): Promise<void> {
      const e = live(this.key(id));
      if (e) e.payload.consumed = Math.floor(Date.now() / 1000);
    }

    async destroy(id: string): Promise<void> {
      entries.delete(this.key(id));
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      for (const [key, e] of entries) {
        if (e.payload.grantId === grantId) entries.delete(key);
      }
    }
  }

  return { Adapter, sweep, size: () => entries.size };
}
