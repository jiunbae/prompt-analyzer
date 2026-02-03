# Task 02: Authentication API Routes

## Objective
Create API routes for user authentication with email/password and admin allowlist.

## Context
- Codebase: `/Users/username/workspace/prompt-manager`
- Framework: Next.js 16 App Router
- Existing auth: Simple password in `/src/app/api/auth/login/route.ts`

## Requirements

### 1. Install bcrypt for password hashing
Add to package.json dependencies: `bcryptjs` and `@types/bcryptjs`

### 2. Create `/api/auth/register` route
Location: `src/app/api/auth/register/route.ts`

```typescript
// POST /api/auth/register
// Body: { email, password, name? }
// Flow:
// 1. Check if email is in allowed_emails table
// 2. Check if user already exists
// 3. Hash password with bcrypt
// 4. Create user with generated token (UUID)
// 5. Return success (don't auto-login)
```

### 3. Update `/api/auth/login` route
Location: `src/app/api/auth/login/route.ts`

```typescript
// POST /api/auth/login
// Body: { email, password }
// Flow:
// 1. Find user by email
// 2. Verify password with bcrypt
// 3. Create session token (JWT or simple base64 with user info)
// 4. Set httpOnly cookie with user id and token
// 5. Update lastLoginAt
```

### 4. Create `/api/auth/logout` route
Location: `src/app/api/auth/logout/route.ts`
- Clear auth cookie
- Return success

### 5. Create `/api/auth/me` route
Location: `src/app/api/auth/me/route.ts`
- Return current user info (id, email, name, token, isAdmin)
- Used by frontend to check auth state

### 6. Create `/api/admin/allowlist` routes
Location: `src/app/api/admin/allowlist/route.ts`
- GET: List all allowed emails (admin only)
- POST: Add email to allowlist (admin only)
- DELETE: Remove email from allowlist (admin only)

## Middleware Update
Update `src/middleware.ts`:
- Parse user from cookie
- Add user info to request headers for downstream use
- Admin routes check isAdmin flag

## Files to Create/Modify
- `src/app/api/auth/register/route.ts` (new)
- `src/app/api/auth/login/route.ts` (modify)
- `src/app/api/auth/logout/route.ts` (new)
- `src/app/api/auth/me/route.ts` (new)
- `src/app/api/admin/allowlist/route.ts` (new)
- `src/middleware.ts` (modify)
- `src/lib/auth.ts` (new - helper functions)

## Deliverables
Write results to: `.context/impl/20260203_multiuser_system/02-auth-api-result.md`
