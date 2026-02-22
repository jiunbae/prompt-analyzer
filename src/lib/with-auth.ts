import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME, type SessionPayload } from "@/lib/auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export { type SessionPayload };

/**
 * Extract and verify the current user's session from cookies.
 * Throws AuthError if not authenticated or token is invalid.
 */
export async function requireAuth(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) {
    throw new AuthError("Not authenticated", 401);
  }
  const session = parseSessionToken(sessionToken);
  if (!session) {
    throw new AuthError("Invalid session", 401);
  }
  return session;
}

/**
 * Verify the current user is an admin by checking the DB directly.
 * This avoids stale isAdmin claims in the session token.
 * Throws AuthError if not authenticated or not an admin.
 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireAuth();
  const [row] = await db
    .select({ isAdmin: schema.users.isAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!row || !row.isAdmin) {
    throw new AuthError("Admin access required", 403);
  }
  return session;
}

export class AuthError extends Error {
  status: 401 | 403;

  constructor(message: string, status: 401 | 403 = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
