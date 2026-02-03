# Task 04: Data Migration Script - Implementation Result

## Summary

Successfully implemented the data migration script and updated all required services/pages for multi-user support.

## Files Created

### 1. `/Users/username/workspace/prompt-manager/scripts/migrate-to-multiuser.ts`

Migration script that:
- Creates initial admin user "admin@example.com" with admin privileges
- Adds the admin email to the allowlist
- Migrates all existing prompts (without user_id) to the admin user
- Is idempotent (safe to run multiple times)
- Generates a secure random password if ADMIN_PASSWORD env var is not set

Usage:
```bash
# With generated password
npx tsx scripts/migrate-to-multiuser.ts

# With custom password
ADMIN_PASSWORD=your_secure_password npx tsx scripts/migrate-to-multiuser.ts
```

Key features:
- Checks for existing admin user before creating
- Checks for existing allowlist entry before adding
- Only updates prompts that have null user_id
- Provides detailed logging and summary

## Files Modified

### 2. `/Users/username/workspace/prompt-manager/src/services/sync.ts`

Added multi-user support to sync service:
- New `SyncOptions` interface with `userToken` and `userId` fields
- `syncAll(options?)` - accepts optional user context for user-scoped syncing
- `syncIncremental(since, options?)` - accepts optional user context
- New `findUserByToken(token)` function to lookup users by their MinIO token
- MinIO path structure for multi-user: `{user_token}/year/month/day/timestamp.json`
- Backwards compatible - works without options for legacy/admin use

### 3. `/Users/username/workspace/prompt-manager/src/app/api/sync/route.ts`

Updated sync API endpoint:
- Accepts `X-User-Token` header for external tool authentication (Claude Code hook)
- Falls back to session cookie authentication for web UI
- Passes user context to sync functions for user-scoped syncing
- Returns `userScoped: boolean` in response to indicate scope of sync

Authentication flow:
1. Check `X-User-Token` header (for external tools)
2. If no token, check session via middleware headers (`x-user-id`, `x-user-token`)
3. Proceed with user-scoped sync if authenticated, global sync otherwise

### 4. `/Users/username/workspace/prompt-manager/src/app/(dashboard)/prompts/page.tsx`

Added user filtering:
- New `getCurrentUser()` function to read session from cookie
- `getPrompts()` now accepts `userId` parameter
- All queries filter by `userId` when user is logged in
- Projects list also filtered by user
- Count and pagination respect user filter

### 5. `/Users/username/workspace/prompt-manager/src/app/(dashboard)/prompts/[id]/page.tsx`

Added ownership verification:
- Added `getCurrentUser()` function
- `getPrompt()` now verifies the prompt belongs to the current user
- Returns 404 if prompt doesn't exist OR doesn't belong to user

### 6. `/Users/username/workspace/prompt-manager/src/app/(dashboard)/analytics/page.tsx`

Added user-scoped analytics:
- Added `getCurrentUser()` function
- All analytics queries now filter by `userId`
- Stats (total prompts, tokens, projects) are user-specific
- Daily activity chart shows only user's activity
- Top projects list shows only user's projects
- Prompt type distribution is user-specific
- Recent activity shows only user's prompts

### 7. `/Users/username/workspace/prompt-manager/src/middleware.ts`

Added token authentication bypass:
- New `tokenAuthRoutes` array for routes accepting X-User-Token
- `/api/sync` route allows requests with X-User-Token header to bypass session auth
- Token validation delegated to route handler

## API Endpoints

### POST /api/sync

Trigger a sync operation for the authenticated user.

**Authentication** (one of):
- Header: `X-User-Token: {user_token}` (for external tools)
- Cookie: `auth_session` (for web UI)

**Request Body:**
```json
{
  "type": "full" | "incremental",
  "since": "2024-01-01T00:00:00Z"  // required for incremental
}
```

**Response:**
```json
{
  "success": true,
  "type": "full",
  "userScoped": true,
  "filesProcessed": 100,
  "filesAdded": 50,
  "filesSkipped": 50,
  "duration": 1234,
  "errorCount": 0
}
```

## MinIO Path Structure

### Legacy (single-user):
```
bucket/
  2024/
    01/
      15/
        1705312800_abc123.json
```

### Multi-user:
```
bucket/
  {user_token}/
    2024/
      01/
        15/
          1705312800_abc123.json
```

## Migration Workflow

1. Deploy schema changes (users, allowed_emails tables, prompts.user_id column)
2. Run migration script: `npx tsx scripts/migrate-to-multiuser.ts`
3. Save the generated admin password
4. Login as admin at `/login`
5. Add other users via admin panel or allowlist

## Security Considerations

- User token is a UUID, not guessable
- Prompts are strictly filtered by user_id
- Ownership checked on detail page to prevent URL guessing
- Admin flag checked for admin routes
- Token authentication for external tools (Claude Code hook)

## Testing Checklist

- [ ] Run migration script on empty database
- [ ] Run migration script on database with existing prompts
- [ ] Run migration script multiple times (idempotency)
- [ ] Login as admin user
- [ ] View prompts list (should show all migrated prompts)
- [ ] View prompt detail (should work for owned prompts)
- [ ] View analytics (should show user-specific stats)
- [ ] Trigger sync via web UI
- [ ] Trigger sync via X-User-Token header
- [ ] Create new user and verify isolated data

## Dependencies

- bcryptjs (for password hashing in migration script)
- drizzle-orm (for database operations)
- postgres (for database connection)

## Notes

- The migration script uses inline schema definitions to avoid path alias issues when running directly with tsx
- The sync service maintains backwards compatibility for legacy single-user setups
- Analytics queries use both Drizzle ORM filters and raw SQL for complex conditions
