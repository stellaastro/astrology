import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
// VALUE import, not `import type`. NestJS resolves constructor dependencies
// from emitDecoratorMetadata, and a type-only import is erased at compile
// time — leaving nothing to emit and producing an opaque
// "can't resolve dependencies (?)" at boot. Inject PrismaService rather than
// PrismaClient so there is one concrete provider and no aliasing.
import { PrismaService } from '../prisma/prisma.service';

export interface IdempotentResult<T> {
  /** True when this call did the work; false when a stored result was returned. */
  executed: boolean;
  value: T;
}

const DEFAULT_TTL_HOURS = 24;

/**
 * Idempotency keys.
 *
 * Guards the two places where a repeated request costs real money:
 *
 *   - BOOKING CREATION. A double-click that creates two Razorpay orders for one
 *     slot is the most likely incident at launch. The slot's unique index stops
 *     the second booking, but it does not stop the second charge — the index
 *     protects the slot, not the customer's card.
 *   - RAZORPAY WEBHOOKS. Gateways retry. A webhook processed twice must not
 *     confirm a booking twice or send two confirmation emails.
 *
 * Three properties that matter, each of which is a way this goes wrong:
 *
 *   1. The request body is hashed. Reusing a key with a DIFFERENT body is a
 *      client bug and is rejected loudly (409) rather than silently returning
 *      the first response — otherwise a mistyped key returns someone else's
 *      booking.
 *   2. Concurrent duplicates are serialised by the primary key, not by a
 *      read-then-write check. Two simultaneous requests both passing a "does
 *      this key exist?" read is exactly the race this class exists to prevent,
 *      so the insert itself is the lock.
 *   3. A crash mid-flight leaves the row 'in_progress'. That is deliberately
 *      NOT treated as complete: it is retryable after the TTL, because
 *      pretending unfinished work finished is worse than doing it twice.
 */
@Injectable()
export class IdempotencyService {
  private readonly log = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  static hash(body: unknown): string {
    // Stable stringify: key order must not change the hash, or a client that
    // serialises its JSON differently on retry looks like a body mismatch.
    return createHash('sha256').update(stableStringify(body)).digest('hex');
  }

  /**
   * Runs `work` at most once per (scope, key).
   *
   * @throws ConflictException when the key was used with a different body, or
   *   when a previous attempt is still in flight.
   */
  async run<T>(
    scope: string,
    key: string,
    body: unknown,
    work: () => Promise<T>,
    ttlHours = DEFAULT_TTL_HOURS,
  ): Promise<IdempotentResult<T>> {
    const requestHash = IdempotencyService.hash(body);
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key: scopedKey(scope, key) },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'This idempotency key was already used with a different request body.',
        );
      }
      if (existing.status === 'completed') {
        return { executed: false, value: existing.response as T };
      }
      if (existing.expiresAt > new Date()) {
        throw new ConflictException(
          'A request with this idempotency key is still in progress.',
        );
      }
      // Expired and unfinished: the previous attempt died. Retry is correct.
      this.log.warn(
        `Retrying expired in-progress idempotency key ${scope}:${key} — the ` +
          `earlier attempt did not complete.`,
      );
    }

    // The insert IS the lock. A read-then-write check loses the race that this
    // class exists to prevent.
    try {
      await this.prisma.idempotencyKey.upsert({
        where: { key: scopedKey(scope, key) },
        create: {
          key: scopedKey(scope, key),
          scope,
          requestHash,
          status: 'in_progress',
          expiresAt,
        },
        update: { requestHash, status: 'in_progress', expiresAt },
      });
    } catch (err) {
      // Unique violation: another request won the race between our read and
      // this write. That is the guard working, not a failure.
      throw new ConflictException(
        'A request with this idempotency key is already in progress.',
      );
    }

    const value = await work();

    await this.prisma.idempotencyKey.update({
      where: { key: scopedKey(scope, key) },
      data: { status: 'completed', response: value as never },
    });

    return { executed: true, value };
  }

  /** Removes expired keys. Called by the scheduler, not on the request path. */
  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: now }, status: 'completed' },
    });
    return count;
  }
}

/** Scoping stops a booking key colliding with a webhook key of the same value. */
function scopedKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

/** Deterministic JSON: object keys sorted, arrays left in order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
