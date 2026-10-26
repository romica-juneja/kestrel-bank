import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/connection.js';

export const SESSION_COOKIE = 'fb_session';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Server-side sessions. The cookie holds a random 256-bit token; only its SHA-256 is stored,
 * so a leaked database does not leak usable sessions. Sessions expire after an idle period.
 */
export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly idleMinutes: number,
  ) {}

  create(customerId: string, now = new Date()): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), customerId, this.expiry(now));
    return token;
  }

  /** Returns the customer id for a valid session and slides its expiry forward. */
  resolve(token: string | undefined, now = new Date()): string | null {
    if (!token) return null;
    const hash = hashToken(token);
    const row = this.db
      .prepare('SELECT customer_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(hash) as { customer_id: string; expires_at: string } | undefined;
    if (!row) return null;
    if (row.expires_at <= now.toISOString()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(this.expiry(now), hash);
    return row.customer_id;
  }

  revoke(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  private expiry(now: Date): string {
    return new Date(now.getTime() + this.idleMinutes * 60_000).toISOString();
  }
}
