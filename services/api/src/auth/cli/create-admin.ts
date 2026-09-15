/**
 * Creates or re-passwords the admin account.
 *
 *   node dist/auth/cli/create-admin.js admin@stellaastro.com 'the password'
 *
 * Deliberately a one-off command rather than a seed: seeds are environment-
 * gated and must never run in production (ADR-026), but this account only
 * exists in production. It is also not an HTTP endpoint, because an endpoint
 * that mints administrators is a hole whatever is put in front of it.
 *
 * Re-running it on an existing account resets the password and REVOKES every
 * open session — which is what you want if the password is being reset because
 * it may have leaked.
 */
import { PrismaClient } from '@prisma/client';
import { monotonicFactory } from 'ulid';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../password';

const ulid = monotonicFactory();

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('usage: create-admin <email> <password>');
    console.error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const normalised = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    const existing = await prisma.user.findUnique({ where: { email: normalised } });

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null, disabledAt: null },
      });
      const { count } = await prisma.session.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      console.log(`Reset password for ${normalised} (${existing.id})`);
      console.log(`Revoked ${count} open session(s) — a reset ends every existing login.`);
    } else {
      const user = await prisma.user.create({
        data: {
          id: ulid(),
          email: normalised,
          name: 'admin',
          passwordHash,
          roles: ['admin:super'],
        },
      });
      console.log(`Created ${normalised} (${user.id}) with roles admin:super`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  // The password may be in argv; never echo the invocation back.
  console.error('create-admin failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
