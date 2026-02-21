import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME, type SessionPayload } from "@/lib/auth";

export { type SessionPayload };

/**
 * Extract and verify the current user's session from cookies.
 * Throws AuthError if not authenticated or token is invalid.
 */
export async function requireAuth(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) {
    throw new AuthError("Not authenticated");
  }
  const session = parseSessionToken(sessionToken);
  if (!session) {
    throw new AuthError("Invalid session");
  }
  return session;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

