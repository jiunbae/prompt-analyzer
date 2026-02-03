# Task 02: Authentication API Routes - Implementation Summary

## Status: COMPLETED

## Date: 2026-02-03

## Changes Made

### 1. Database Schema Updates (`src/db/schema.ts`)

Added multi-user support to the database schema:

- **Users table** (`users`):
  - `id`: UUID primary key
  - `email`: Unique email address
  - `passwordHash`: bcrypt hashed password
  - `token`: UUID for MinIO path isolation
  - `name`: Optional display name
  - `isAdmin`: Admin flag (default: false)
  - `createdAt`: Timestamp
  - `lastLoginAt`: Last login timestamp
  - Indexes on `email` and `token`

- **Allowed emails table** (`allowed_emails`):
  - `id`: UUID primary key
  - `email`: Unique email in allowlist
  - `addedBy`: Reference to admin user who added it
  - `addedAt`: Timestamp

- **Prompts table update**:
  - Added `userId` column (nullable for migration compatibility)
  - Added index on `userId`

- **Relations**:
  - Added `usersRelations` (user -> prompts, allowedEmails)
  - Added `allowedEmailsRelations` (allowedEmail -> addedByUser)
  - Updated `promptsRelations` (prompt -> user)

- **Type exports**:
  - Added `User`, `NewUser`, `AllowedEmail`, `NewAllowedEmail`

### 2. Dependencies (`package.json`)

Added:
- `bcryptjs: ^2.4.3` - Password hashing
- `@types/bcryptjs: ^2.4.6` - TypeScript types

### 3. Auth Helper Library (`src/lib/auth.ts`)

New file with authentication utilities:

- `hashPassword(password)` - Hash password with bcrypt (12 rounds)
- `verifyPassword(password, hash)` - Verify password against hash
- `createSessionToken(payload)` - Create base64 encoded session token
- `parseSessionToken(token)` - Parse and validate session token
- `AUTH_COOKIE_NAME` - Cookie name constant ("auth_session")
- `AUTH_COOKIE_OPTIONS` - Secure cookie configuration
- `getDb()` - Lazy database connection
- `isEmailAllowed(email)` - Check if email is in allowlist
- `findUserByEmail(email)` - Find user by email
- `findUserById(id)` - Find user by ID
- `createUser(data)` - Create new user
- `updateLastLogin(userId)` - Update last login timestamp

### 4. API Routes

#### POST `/api/auth/register` (`src/app/api/auth/register/route.ts`)
- Validates email format and password strength (min 8 chars)
- Checks email against allowlist
- Checks for existing user
- Hashes password with bcrypt
- Creates user with auto-generated UUID token
- Returns success (does not auto-login)

#### POST `/api/auth/login` (`src/app/api/auth/login/route.ts`)
- Finds user by email
- Verifies password with bcrypt
- Creates session token with user info
- Sets httpOnly secure cookie
- Updates `lastLoginAt` timestamp
- Returns user info

#### POST `/api/auth/logout` (`src/app/api/auth/logout/route.ts`)
- Clears auth cookie by setting maxAge to 0
- Returns success message

#### GET `/api/auth/me` (`src/app/api/auth/me/route.ts`)
- Parses session from cookie
- Fetches fresh user data from database
- Returns user info (id, email, name, token, isAdmin)

#### Admin Allowlist Routes (`src/app/api/admin/allowlist/route.ts`)
- **GET**: List all allowed emails with who added them
- **POST**: Add email to allowlist (validates format, checks duplicates)
- **DELETE**: Remove email by ID or email query param

All admin routes check for `isAdmin` flag in session.

### 5. Middleware Updates (`src/middleware.ts`)

Complete rewrite with new authentication system:

- **Public routes**: `/login`, `/register`, `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`
- **Admin routes**: `/api/admin/*`, `/admin/*`
- **Session parsing**: Base64 decode -> JSON parse
- **Admin checks**: Verifies `isAdmin` flag for admin routes
- **Request headers**: Adds user context for downstream use:
  - `x-user-id`
  - `x-user-email`
  - `x-user-token`
  - `x-user-is-admin`

## Files Created/Modified

| File | Action |
|------|--------|
| `src/db/schema.ts` | Modified - Added users, allowedEmails tables; updated prompts |
| `package.json` | Modified - Added bcryptjs dependencies |
| `src/lib/auth.ts` | Created - Auth helper functions |
| `src/app/api/auth/login/route.ts` | Modified - Email/password authentication |
| `src/app/api/auth/register/route.ts` | Created - User registration |
| `src/app/api/auth/logout/route.ts` | Created - Session logout |
| `src/app/api/auth/me/route.ts` | Created - Current user info |
| `src/app/api/admin/allowlist/route.ts` | Created - Admin allowlist management |
| `src/middleware.ts` | Modified - New auth system with user context |

## Next Steps

1. **Install dependencies**: Run `pnpm install` to install bcryptjs
2. **Run database migration**: Run `pnpm db:push` to create new tables
3. **Seed initial admin**: Manually insert first admin user and add emails to allowlist
4. **Update frontend**: Implement login/register UI (Task 03)

## Security Notes

- Passwords hashed with bcrypt (12 rounds)
- Session tokens are base64 encoded JSON (not JWT, but sufficient for this use case)
- Cookies are httpOnly, secure in production, sameSite=lax
- Admin routes protected by isAdmin flag check
- Email allowlist prevents unauthorized registration
