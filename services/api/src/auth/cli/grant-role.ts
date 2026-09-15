/**
 * Grants or revokes a role on an existing account.
 *
 *   node dist/auth/cli/grant-role.js grant  guruji@stellaastro.com admin:super
 *   node dist/auth/cli/grant-role.js revoke guruji@stellaastro.com admin:super
 *   node dist/auth/cli/grant-role.js show   guruji@stellaastro.com
 *
 * A CLI, not an endpoint, for the same reason create-admin is: an HTTP route
 * that grants administrator rights is a hole whatever is put in front of it.
 *
 * Roles are ADDITIVE (ADR-018) — one identity can be both astrologer and admin,
 * so this adds to the set rather than replacing it. Duplicate grants are a
 * no-op, which makes re-running it safe.
 *
 * The change is WRITTEN TO THE AUDIT LOG. A privilege change that leaves no
 * trace is exactly the kind an investigation needs and cannot find. Raw SQL
 * would not do that, which is why this exists.
 */
import { PrismaClient } from '@prisma/client';
import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

/** Known roles. A typo silently granting nothing is worse than a refusal. */
const KNOWN = ['admin:super', 'admin:support', 'astrologer'];

async function main(): Promise<void> {
  const [action, email, role] = process.argv.slice(2);

  if (!action || !email || (action !== 'show' && !role)) {
    console.error('usage: grant-role <grant|revoke|show> <email> [role]');
    console.error(`roles: ${KNOWN.join(', ')}`);
    process.exit(2);
  }
  if (action !== 'show' && role && !KNOWN.includes(role)) {
    console.error(`Unknown role "${role}". Known roles: ${KNOWN.join(', ')}`);
    console.error('Refusing rather than granting something nothing checks for.');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const normalised = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalised } });
    if (!user) {
      console.error(`No account for ${normalised}. They must sign in once first.`);
      process.exit(1);
    }

    const before = Array.isArray(user.roles) ? (user.roles as string[]) : [];

    if (action === 'show') {
      console.log(`${normalised}: ${before.length ? before.join(', ') : '(no roles)'}`);
      return;
    }

    const after =
      action === 'grant'
        ? [...new Set([...before, role as string])].sort()
        : before.filter((r) => r !== role);

    if (JSON.stringify(before.slice().sort()) === JSON.stringify(after.slice().sort())) {
      console.log(`No change — ${normalised} already ${action === 'grant' ? 'has' : 'lacks'} ${role}.`);
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { roles: after } });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          action: action === 'grant' ? 'user.role.granted' : 'user.role.revoked',
          targetType: 'User',
          targetId: user.id,
          // Before AND after: "what changed" is the question, not "what is it now".
          before: { roles: before },
          after: { roles: after, role },
          actorId: null,
          actorRole: 'cli',
          reason: `grant-role CLI run on the host`,
          ip: null,
          sessionId: null,
        },
      });
    });

    console.log(`${normalised}: ${before.join(', ') || '(none)'} -> ${after.join(', ') || '(none)'}`);

    // Roles are read from the user row on every request (SessionService), so an
    // open session picks this up immediately. Say so, because the opposite —
    // needing to sign out and in — is what people assume.
    console.log('Takes effect immediately; no need to sign out and back in.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('grant-role failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
