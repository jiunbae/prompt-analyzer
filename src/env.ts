import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const isTest =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const testDefaults: Record<string, string> = isTest
  ? {
      DATABASE_URL: "postgres://localhost:5432/omp_test",
      SESSION_SECRET: "test-session-secret-for-testing-only",
    }
  : {};

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  client: {
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL ?? testDefaults.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    SESSION_SECRET: process.env.SESSION_SECRET ?? testDefaults.SESSION_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: isTest || !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
