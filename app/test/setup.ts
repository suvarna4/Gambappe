process.env.GHOST_COOKIE_SECRET = process.env.GHOST_COOKIE_SECRET || "test-ghost-secret";
process.env.CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/receipts_test";
