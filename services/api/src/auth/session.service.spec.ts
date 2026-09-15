import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { SessionService } from './session.service';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

function makePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    session: {
      create: vi.fn(async ({ data }: never) => {
        const d = data as Record<string, unknown>;
        rows.set(d.tokenHash as string, { ...d, lastSeenAt: new Date(), revokedAt: null });
        return d;
      }),
      findUnique: vi.fn(async ({ where }: never) => {
        const r = rows.get((where as { tokenHash: string }).tokenHash);
        return r ?? null;
      }),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async ({ where, data }: never) => {
        const w = where as Record<string, unknown>;
        let count = 0;
        for (const [k, r] of rows) {
          const match = w.tokenHash ? k === w.tokenHash : r.userId === w.userId;
          if (match && r.revokedAt === null) {
            rows.set(k, { ...r, ...(data as Record<string, unknown>) });
            count++;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
}

const USER: { id: string; email: string; roles: string[]; disabledAt: Date | null } = {
  id: 'u1',
  email: 'a@b.com',
  roles: ['admin:super'],
  disabledAt: null,
};

describe('SessionService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: SessionService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new SessionService(prisma as never);
  });

  const attach = (token: string, user = USER, over: Record<string, unknown> = {}) => {
    const row = prisma.rows.get(hash(token))!;
    prisma.rows.set(hash(token), { ...row, user, ...over });
  };

  it('issues a token and resolves it back to the user', async () => {
    const { token } = await svc.create('u1');
    attach(token);
    expect((await svc.resolve(token))?.id).toBe('u1');
  });

  /** The property that makes a table dump useless for resuming a session. */
  it('stores only the hash, never the token', async () => {
    const { token } = await svc.create('u1');
    expect(prisma.rows.has(token)).toBe(false);
    expect(prisma.rows.has(hash(token))).toBe(true);
    expect(JSON.stringify([...prisma.rows.values()])).not.toContain(token);
  });

  it('issues a different token every time', async () => {
    const a = await svc.create('u1');
    const b = await svc.create('u1');
    expect(a.token).not.toBe(b.token);
  });

  it('returns null for an unknown token', async () => {
    expect(await svc.resolve('never-issued')).toBeNull();
  });

  it('returns null for no token at all', async () => {
    expect(await svc.resolve(undefined)).toBeNull();
  });

  it('returns null once revoked — signing out actually ends it', async () => {
    const { token } = await svc.create('u1');
    attach(token);
    expect(await svc.resolve(token)).not.toBeNull();
    await svc.revoke(token);
    expect(await svc.resolve(token)).toBeNull();
  });

  it('revoking twice is not an error', async () => {
    const { token } = await svc.create('u1');
    attach(token);
    await svc.revoke(token);
    await expect(svc.revoke(token)).resolves.toBeUndefined();
  });

  it('returns null once expired', async () => {
    const { token } = await svc.create('u1');
    attach(token, USER, { expiresAt: new Date(Date.now() - 1000) });
    expect(await svc.resolve(token)).toBeNull();
  });

  /**
   * THE REASON THIS TABLE EXISTS. With a self-contained token the holder would
   * keep access until it expired; disabling an account must end it now.
   */
  it('returns null the moment the account is disabled, without touching the session', async () => {
    const { token } = await svc.create('u1');
    attach(token);
    expect(await svc.resolve(token)).not.toBeNull();
    attach(token, { ...USER, disabledAt: new Date() });
    expect(await svc.resolve(token)).toBeNull();
  });

  it('revokes every session for a user at once', async () => {
    const a = await svc.create('u1');
    const b = await svc.create('u1');
    const other = await svc.create('u2');
    [a, b].forEach((s) => attach(s.token));
    attach(other.token, { ...USER, id: 'u2' });

    expect(await svc.revokeAllForUser('u1')).toBe(2);
    expect(await svc.resolve(a.token)).toBeNull();
    expect(await svc.resolve(b.token)).toBeNull();
    expect(await svc.resolve(other.token)).not.toBeNull(); // untouched
  });

  it('carries roles through, so the guard can read them', async () => {
    const { token } = await svc.create('u1');
    attach(token);
    expect((await svc.resolve(token))?.roles).toEqual(['admin:super']);
  });

  it('treats a non-array roles column as no roles rather than crashing', async () => {
    const { token } = await svc.create('u1');
    attach(token, { ...USER, roles: 'admin:super' as unknown as string[] });
    expect((await svc.resolve(token))?.roles).toEqual([]);
  });

  it('sets an expiry in the future', async () => {
    const { expiresAt } = await svc.create('u1');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
