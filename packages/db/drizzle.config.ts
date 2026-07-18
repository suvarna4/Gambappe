import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts',
  },
  migrations: {
    prefix: 'index',
  },
  strict: true,
  verbose: true,
});
