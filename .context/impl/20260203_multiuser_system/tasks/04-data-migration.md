# Task 04: Data Migration Script

## Objective
Create a migration script to:
1. Create initial admin user "admin"
2. Associate all existing prompts with this user
3. Add admin's email to allowlist

## Context
- Codebase: `/Users/username/workspace/prompt-manager`
- Database: PostgreSQL via Drizzle ORM
- Existing prompts: ~570 records without user_id

## Requirements

### 1. Create Migration Script
Location: `scripts/migrate-to-multiuser.ts`

```typescript
// Script to run once after schema migration
// Usage: npx tsx scripts/migrate-to-multiuser.ts

async function main() {
  // 1. Create admin user "admin"
  const adminUser = await db.insert(users).values({
    email: "admin@example.com", // or appropriate email
    passwordHash: await bcrypt.hash("INITIAL_PASSWORD", 10),
    name: "Jiun",
    isAdmin: true,
  }).returning();

  // 2. Add email to allowlist
  await db.insert(allowedEmails).values({
    email: "admin@example.com",
    addedBy: adminUser[0].id,
  });

  // 3. Update all existing prompts to belong to admin
  await db.update(prompts)
    .set({ userId: adminUser[0].id })
    .where(isNull(prompts.userId));

  console.log(`Migrated ${count} prompts to user admin`);
}
```

### 2. Update Sync Service
Location: `src/services/sync.ts`

Modify sync to:
- Accept user token as parameter
- Store prompts with user_id
- MinIO path structure: `{user_token}/timestamp_prompt.json`

### 3. Update Prompts Queries
Locations:
- `src/app/(dashboard)/prompts/page.tsx`
- `src/app/(dashboard)/prompts/[id]/page.tsx`
- `src/app/(dashboard)/analytics/page.tsx`

Add user filtering:
- Get current user from cookie/session
- Filter prompts by userId
- Analytics should be per-user

### 4. Create API for Sync with Token
Location: `src/app/api/sync/route.ts`

```typescript
// POST /api/sync
// Header: X-User-Token: {user_token}
// This allows external tools (Claude Code hook) to trigger sync
// Validates token, finds user, syncs their prompts
```

## Files to Create/Modify
- `scripts/migrate-to-multiuser.ts` (new)
- `src/services/sync.ts` (modify)
- `src/app/(dashboard)/prompts/page.tsx` (modify)
- `src/app/(dashboard)/prompts/[id]/page.tsx` (modify)
- `src/app/(dashboard)/analytics/page.tsx` (modify)
- `src/app/api/sync/route.ts` (new or modify)

## Deliverables
Write results to: `.context/impl/20260203_multiuser_system/04-data-migration-result.md`

## Important Notes
- Script should be idempotent (safe to run multiple times)
- Don't delete any existing data
- Log all changes for audit
