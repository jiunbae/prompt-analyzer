#!/usr/bin/env npx tsx
/**
 * Migration script for multi-user support
 *
 * This script:
 * 1. Creates an initial admin user
 * 2. Adds admin email to the allowlist
 * 3. Associates all existing prompts with the admin user
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com npx tsx scripts/migrate-to-multiuser.ts
 *
 * Environment variables required:
 * - DATABASE_URL: PostgreSQL connection string
 * - ADMIN_EMAIL: Email for the initial admin user
 * - ADMIN_NAME: Display name for admin (optional, defaults to "Admin")
 * - ADMIN_PASSWORD: Initial password (optional, generates one if not set)
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { isNull, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

// Schema imports (inline to avoid path alias issues in scripts)
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

// Define schema inline to avoid import issues
const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  token: uuid("token")
    .notNull()
    .unique()
    .default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

const allowedEmails = pgTable("allowed_emails", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  addedBy: uuid("added_by"),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
});

const prompts = pgTable("prompts", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  eventKey: varchar("event_key", { length: 255 }).notNull().unique(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  workingDirectory: varchar("working_directory", { length: 500 }),
  promptLength: integer("prompt_length").notNull(),
  promptText: text("prompt_text").notNull(),
  projectName: varchar("project_name", { length: 255 }),
  promptType: varchar("prompt_type", { length: 50 }),
  tokenEstimate: integer("token_estimate"),
  wordCount: integer("word_count"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  userId: uuid("user_id"),
});

// Configuration from environment
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";
const SALT_ROUNDS = 12;

function getAdminEmail(): string {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.error("ERROR: ADMIN_EMAIL environment variable is required");
    console.error("Usage: ADMIN_EMAIL=admin@example.com npx tsx scripts/migrate-to-multiuser.ts");
    process.exit(1);
  }
  return email;
}

const ADMIN_EMAIL = getAdminEmail();

function generatePassword(): string {
  const { randomBytes } = require("crypto");
  return randomBytes(16).toString("base64url");
}

async function main() {
  console.log("=".repeat(60));
  console.log("Multi-User Migration Script");
  console.log("=".repeat(60));
  console.log("");

  // Check for DATABASE_URL
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  // Get or generate admin password
  const adminPassword = process.env.ADMIN_PASSWORD || generatePassword();
  const passwordProvided = !!process.env.ADMIN_PASSWORD;

  console.log(`Admin email: ${ADMIN_EMAIL}`);
  console.log(`Admin name: ${ADMIN_NAME}`);
  if (!passwordProvided) {
    console.log(`Generated password: ${adminPassword}`);
    console.log(
      "NOTE: Save this password! Set ADMIN_PASSWORD env var to use a specific password."
    );
  }
  console.log("");

  // Connect to database
  const client = postgres(connectionString);
  const db = drizzle(client);

  try {
    // Step 1: Check if admin user already exists
    console.log("Step 1: Checking for existing admin user...");
    const existingUsers = await db
      .select()
      .from(users)
      .where(sql`${users.email} = ${ADMIN_EMAIL.toLowerCase()}`)
      .limit(1);

    let adminUser;

    if (existingUsers.length > 0) {
      adminUser = existingUsers[0];
      console.log(`  Found existing user: ${adminUser.email} (id: ${adminUser.id})`);
      console.log(`  Skipping user creation.`);
    } else {
      // Create admin user
      console.log("  Creating admin user...");
      const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

      const [newUser] = await db
        .insert(users)
        .values({
          email: ADMIN_EMAIL.toLowerCase(),
          passwordHash,
          name: ADMIN_NAME,
          isAdmin: true,
        })
        .returning();

      adminUser = newUser;
      console.log(`  Created admin user: ${adminUser.email}`);
      console.log(`  User ID: ${adminUser.id}`);
      console.log(`  User token: ${adminUser.token}`);
    }
    console.log("");

    // Step 2: Add email to allowlist
    console.log("Step 2: Checking allowlist...");
    const existingAllowed = await db
      .select()
      .from(allowedEmails)
      .where(sql`${allowedEmails.email} = ${ADMIN_EMAIL.toLowerCase()}`)
      .limit(1);

    if (existingAllowed.length > 0) {
      console.log(`  Email already in allowlist.`);
    } else {
      console.log("  Adding email to allowlist...");
      await db.insert(allowedEmails).values({
        email: ADMIN_EMAIL.toLowerCase(),
        addedBy: adminUser.id,
      });
      console.log(`  Added ${ADMIN_EMAIL} to allowlist.`);
    }
    console.log("");

    // Step 3: Count prompts without user_id
    console.log("Step 3: Migrating prompts...");
    const orphanedPromptsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(prompts)
      .where(isNull(prompts.userId));

    const orphanedCount = Number(orphanedPromptsResult[0]?.count ?? 0);
    console.log(`  Found ${orphanedCount} prompts without user_id.`);

    if (orphanedCount > 0) {
      // Update all prompts without userId to belong to admin
      const result = await db
        .update(prompts)
        .set({ userId: adminUser.id })
        .where(isNull(prompts.userId));

      console.log(`  Migrated prompts to user: ${adminUser.email}`);
    } else {
      console.log(`  No prompts to migrate.`);
    }
    console.log("");

    // Summary
    console.log("=".repeat(60));
    console.log("Migration Summary");
    console.log("=".repeat(60));
    console.log(`Admin User: ${adminUser.email} (${adminUser.id})`);
    console.log(`User Token: ${adminUser.token}`);
    console.log(`Prompts Migrated: ${orphanedCount}`);
    if (!passwordProvided && existingUsers.length === 0) {
      console.log("");
      console.log("IMPORTANT: Save the generated password above!");
      console.log(`Password: ${adminPassword}`);
    }
    console.log("=".repeat(60));
    console.log("");
    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("");
    console.error("ERROR: Migration failed!");
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
