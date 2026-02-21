import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

let _instance: PostgresJsDatabase<typeof schema> | null = null;

function getInstance(): PostgresJsDatabase<typeof schema> {
  if (!_instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    const client = postgres(connectionString, { max: 20 });
    _instance = drizzle(client, { schema });
  }
  return _instance;
}

/**
 * Shared database client singleton with connection pooling (max 20).
 * Lazy-initialized on first property access to avoid build-time failures
 * when DATABASE_URL is not set (e.g., during `next build`).
 */
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const instance = getInstance();
      const value = Reflect.get(instance, prop, receiver);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  },
);
