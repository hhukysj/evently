import { createHash } from "node:crypto";
import type { Store, Options } from "express-rate-limit";
import type { Pool } from "pg";

interface CounterRow {
  hits: number;
  reset_at: Date;
}

export class PostgresRateLimitStore implements Store {
  localKeys = false;
  private windowMs?: number;
  private cleanupTimer?: NodeJS.Timeout;
  private readonly knownKeyHashes = new Set<string>();

  constructor(
    private readonly pool: Pool,
    private readonly scope: string,
    windowMs?: number,
  ) {
    this.windowMs = windowMs;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.cleanupTimer = setInterval(
      () => {
        void this.pruneExpired().catch((error: unknown) => {
          console.error("Rate-limit counter cleanup failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
        });
      },
      5 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  async increment(key: string) {
    if (this.windowMs === undefined) {
      throw new Error("Rate-limit store was not initialized");
    }

    const keyHash = this.hashKey(key);
    const { rows } = await this.pool.query<CounterRow>(
      `INSERT INTO rate_limit_counters (key_hash, hits, reset_at)
       VALUES ($1, 1, now() + ($2 * interval '1 millisecond'))
       ON CONFLICT (key_hash) DO UPDATE SET
         hits = CASE
           WHEN rate_limit_counters.reset_at <= now() THEN 1
           ELSE rate_limit_counters.hits + 1
         END,
         reset_at = CASE
           WHEN rate_limit_counters.reset_at <= now()
             THEN now() + ($2 * interval '1 millisecond')
           ELSE rate_limit_counters.reset_at
         END
       RETURNING hits, reset_at`,
      [keyHash, this.windowMs],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("Rate-limit counter update returned no row");
    }
    return {
      totalHits: Number(row.hits),
      resetTime: new Date(row.reset_at),
    };
  }

  async get(key: string) {
    const { rows } = await this.pool.query<CounterRow>(
      `SELECT hits, reset_at
       FROM rate_limit_counters
       WHERE key_hash = $1 AND reset_at > now()`,
      [this.hashKey(key)],
    );
    const row = rows[0];
    return row
      ? { totalHits: Number(row.hits), resetTime: new Date(row.reset_at) }
      : undefined;
  }

  async decrement(key: string): Promise<void> {
    await this.pool.query(
      `UPDATE rate_limit_counters
       SET hits = greatest(hits - 1, 0)
       WHERE key_hash = $1`,
      [this.hashKey(key)],
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM rate_limit_counters WHERE key_hash = $1",
      [this.hashKey(key)],
    );
  }

  async clear(): Promise<void> {
    if (this.knownKeyHashes.size === 0) {
      return;
    }
    await this.pool.query(
      "DELETE FROM rate_limit_counters WHERE key_hash = ANY($1::varchar[])",
      [[...this.knownKeyHashes]],
    );
    this.knownKeyHashes.clear();
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private hashKey(key: string): string {
    const keyHash = createHash("sha256")
      .update(`${this.scope}\0${key}`, "utf8")
      .digest("hex");
    this.knownKeyHashes.add(keyHash);
    return keyHash;
  }

  private async pruneExpired(): Promise<void> {
    await this.pool.query(
      `DELETE FROM rate_limit_counters
       WHERE key_hash IN (
         SELECT key_hash
         FROM rate_limit_counters
         WHERE reset_at <= now()
         LIMIT 1000
       )`,
    );
  }
}
