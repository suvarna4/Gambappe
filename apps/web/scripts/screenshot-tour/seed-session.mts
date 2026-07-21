/** Throwaway: attach a users row + Auth.js database session to the seeded Fox profile. */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { connect, profiles, sessions, users } from '@receipts/db';

const { pool, db } = connect();
try {
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `fox-screenshot-${randomUUID()}@example.test`,
    ageAttestedAt: new Date(),
  });
  await db.update(profiles).set({ userId }).where(eq(profiles.slug, 'fox-4821'));
  const sessionToken = randomUUID();
  await db.insert(sessions).values({
    sessionToken,
    userId,
    expires: new Date(Date.now() + 30 * 86_400_000),
  });
  console.log(sessionToken);
} finally {
  await pool.end();
}
