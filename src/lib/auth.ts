import bcrypt from "bcryptjs";
import crypto from "crypto";

const SALT_ROUNDS = 12;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET && process.env.NODE_ENV === "production" && typeof window === "undefined") {
  console.warn("WARNING: SESSION_SECRET is not set. Sessions will not work.");
}
// When SESSION_SECRET is missing, use empty string so token operations return null
// (matching middleware behavior which also rejects empty secrets).
const EFFECTIVE_SECRET = SESSION_SECRET || "";

/**
 * Hash a password using bcrypt
 * @param password - Plain text password
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 * @param password - Plain text password
 * @param hash - Hashed password
 * @returns True if password matches
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Session token payload
 */
export interface SessionPayload {
  userId: string;
  email: string;
  token: string; // User's API token
  isAdmin: boolean;
}

/**
 * Create a signed session token (HMAC-SHA256)
 * @param payload - Session data
 * @returns Signed session token (payload.signature)
 */
export function createSessionToken(payload: SessionPayload): string {
  if (!EFFECTIVE_SECRET) {
    throw new Error("SESSION_SECRET is not configured. Cannot create session tokens.");
  }
  const data = JSON.stringify({
    ...payload,
    iat: Date.now(),
  });
  const encoded = Buffer.from(data).toString("base64url");
  const signature = crypto
    .createHmac("sha256", EFFECTIVE_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Parse and verify a signed session token
 * @param token - Signed session token
 * @returns Session payload or null if invalid/tampered
 */
const MAX_TOKEN_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function parseSessionToken(token: string): SessionPayload | null {
  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) {
      return null; // Reject unsigned tokens
    }

    const encoded = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);

    const expectedSig = crypto
      .createHmac("sha256", EFFECTIVE_SECRET)
      .update(encoded)
      .digest("base64url");

    if (signature.length !== expectedSig.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    const data = Buffer.from(encoded, "base64url").toString("utf-8");
    const parsed = JSON.parse(data);

    if (!parsed.userId || !parsed.email || !parsed.token) {
      return null;
    }

    if (!parsed.iat || Date.now() - parsed.iat > MAX_TOKEN_AGE_MS) {
      return null; // Token expired
    }

    return {
      userId: parsed.userId,
      email: parsed.email,
      token: parsed.token,
      isAdmin: parsed.isAdmin ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * Auth cookie configuration
 */
export const AUTH_COOKIE_NAME = "auth_session";

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 7, // 7 days
  path: "/",
};

import { db } from "@/db/client";
import { users, allowedEmails } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Check if email is in the allowlist
 */
export async function isEmailAllowed(email: string): Promise<boolean> {
  const [allowed] = await db
    .select()
    .from(allowedEmails)
    .where(eq(allowedEmails.email, email.toLowerCase()))
    .limit(1);

  return !!allowed;
}

/**
 * Find user by email
 */
export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  return user ?? null;
}

/**
 * Find user by ID
 */
export async function findUserById(id: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user ?? null;
}

/**
 * Create a new user
 */
export async function createUser(data: {
  email: string;
  passwordHash: string;
  name?: string;
}) {
  const [user] = await db
    .insert(users)
    .values({
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      name: data.name,
    })
    .returning();

  return user;
}

/**
 * Update user's last login timestamp
 */
export async function updateLastLogin(userId: string) {
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, userId));
}
