# Task 03: Frontend Authentication UI

## Objective
Update frontend to support multi-user auth with login, register, and admin pages.

## Context
- Codebase: `/Users/username/workspace/prompt-manager`
- Framework: Next.js 16 App Router
- Styling: Tailwind CSS
- Existing login: `src/app/login/page.tsx` (simple password)

## Requirements

### 1. Update Login Page
Location: `src/app/login/page.tsx`

- Change from single password to email/password form
- Add "Don't have an account? Register" link
- Show error messages for invalid credentials
- Redirect to /prompts on success

### 2. Create Register Page
Location: `src/app/register/page.tsx`

- Email, password, confirm password, name (optional) fields
- Show error if email not in allowlist
- Show success message and link to login
- Don't auto-login after register

### 3. Create User Context/Provider
Location: `src/contexts/user-context.tsx`

```typescript
// Provide current user info to all components
// Fetch from /api/auth/me on mount
// Export useUser() hook
interface User {
  id: string;
  email: string;
  name?: string;
  token: string;
  isAdmin: boolean;
}
```

### 4. Update Layout with User Info
Location: `src/app/(dashboard)/layout.tsx`

- Show user email in sidebar
- Add logout button
- Show "Admin" badge if isAdmin

### 5. Create Admin Allowlist Page
Location: `src/app/(dashboard)/admin/allowlist/page.tsx`

- List all allowed emails
- Form to add new email
- Delete button for each email
- Only accessible to admin users

### 6. Update Sidebar Navigation
Location: `src/components/sidebar.tsx` (if exists) or layout

- Add "Admin" section (only for admin users)
- Add link to allowlist management

### 7. Add User Token Display in Settings
Location: `src/app/(dashboard)/settings/page.tsx`

- Show user's MinIO token
- Copy button for easy copying
- Instructions on how to configure Claude Code hook

## Public Routes Update
Add `/register` to public routes in middleware

## Files to Create/Modify
- `src/app/login/page.tsx` (modify)
- `src/app/register/page.tsx` (new)
- `src/contexts/user-context.tsx` (new)
- `src/app/(dashboard)/layout.tsx` (modify)
- `src/app/(dashboard)/admin/allowlist/page.tsx` (new)
- `src/app/(dashboard)/settings/page.tsx` (modify)
- `src/middleware.ts` (add /register to public routes)

## Deliverables
Write results to: `.context/impl/20260203_multiuser_system/03-frontend-auth-result.md`
