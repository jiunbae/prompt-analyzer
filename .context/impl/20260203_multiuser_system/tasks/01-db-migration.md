# Task 01: Database Migration for Multi-User System

## Objective
Add user-related tables to the existing PostgreSQL schema using Drizzle ORM.

## Context
- Codebase: `/Users/username/workspace/prompt-manager`
- Existing schema: `src/db/schema.ts`
- ORM: Drizzle with PostgreSQL

## Requirements

### 1. Create `users` table
```typescript
users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  token: uuid("token").notNull().unique().defaultRandom(), // for MinIO path
  name: varchar("name", { length: 100 }),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});
```

### 2. Create `allowed_emails` table (admin allowlist)
```typescript
allowedEmails = pgTable("allowed_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  addedBy: uuid("added_by").references(() => users.id),
  addedAt: timestamp("added_at").defaultNow(),
});
```

### 3. Modify `prompts` table
- Add `userId` column: `userId: uuid("user_id").references(() => users.id)`
- Keep nullable for migration purposes

### 4. Update schema exports
- Export all new tables
- Add proper relations

## Files to Modify
- `src/db/schema.ts` - Add new tables and modify prompts

## Deliverables
1. Updated schema.ts with new tables
2. Write results to: `.context/impl/20260203_multiuser_system/01-db-migration-result.md`

## Notes
- Don't run migrations yet - just update schema file
- User will run `pnpm db:push` manually after review
