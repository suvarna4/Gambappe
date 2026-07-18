import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts',
  },
  // §4.5 migration policy: 0001_init ships the entire base schema (WS0-T3, hand-numbered);
  // every migration after it is a timestamp-prefixed additive change (`YYYYMMDDHHMM_description`).
  migrations: {
    prefix: 'timestamp',
  },
  strict: true,
  verbose: true,
});
