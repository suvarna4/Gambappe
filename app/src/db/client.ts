import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __receiptsSql: ReturnType<typeof postgres> | undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const sql =
  global.__receiptsSql ??
  postgres(connectionString, { max: process.env.NODE_ENV === "test" ? 5 : 10 });

if (process.env.NODE_ENV !== "production") {
  global.__receiptsSql = sql;
}

export const db = drizzle(sql, { schema });
export { sql };

/** Type covering both the base db handle and a transaction callback's tx. */
export type DbOrTx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0] | typeof db;
