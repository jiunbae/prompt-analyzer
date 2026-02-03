import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

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
  token: string; // User's MinIO token
  isAdmin: boolean;
}

/**
 * Create a session token (base64 encoded JSON)
 * @param payload - Session data
 * @returns Encoded session token
 */
export function createSessionToken(payload: SessionPayload): string {
  const data = JSON.stringify({
    ...payload,
    iat: Date.now(),
  });
  return Buffer.from(data).toString("base64");
}

/**
 * Parse a session token
 * @param token - Encoded session token
 * @returns Session payload or null if invalid
 */
export function parseSessionToken(token: string): SessionPayload | null {
  try {
    const data = Buffer.from(token, "base64").toString("utf-8");
    const parsed = JSON.parse(data);

    // Validate required fields
    if (!parsed.userId || !parsed.email || !parsed.token) {
      return null;
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

/**
 * Get database connection
 * Lazily initialized to avoid issues with build time
 */
let db: ReturnType<typeof import("drizzle-orm/postgres-js").drizzle> | null =
  null;
let usersTable: typeof import("@/db/schema").users | null = null;
let allowedEmailsTable: typeof import("@/db/schema").allowedEmails | null =
  null;

export async function getDb() {
  if (!db) {
    const postgres = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const schema = await import("@/db/schema");

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }

    const client = postgres.default(connectionString);
    db = drizzle(client, { schema });
    usersTable = schema.users;
    allowedEmailsTable = schema.allowedEmails;
  }

  return {
    db,
    usersTable: usersTable!,
    allowedEmailsTable: allowedEmailsTable!,
  };
}

/**
 * Check if email is in the allowlist
 * @param email - Email to check
 * @returns True if email is allowed to register
 */
export async function isEmailAllowed(email: string): Promise<boolean> {
  const { db, allowedEmailsTable } = await getDb();
  const { eq } = await import("drizzle-orm");

  const [allowed] = await db
    .select()
    .from(allowedEmailsTable)
    .where(eq(allowedEmailsTable.email, email.toLowerCase()))
    .limit(1);

  return !!allowed;
}

/**
 * Find user by email
 * @param email - Email to search for
 * @returns User or null
 */
export async function findUserByEmail(email: string) {
  const { db, usersTable } = await getDb();
  const { eq } = await import("drizzle-orm");

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  return user ?? null;
}

/**
 * Find user by ID
 * @param id - User ID to search for
 * @returns User or null
 */
export async function findUserById(id: string) {
  const { db, usersTable } = await getDb();
  const { eq } = await import("drizzle-orm");

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);

  return user ?? null;
}

/**
 * Create a new user
 * @param data - User data
 * @returns Created user
 */
export async function createUser(data: {
  email: string;
  passwordHash: string;
  name?: string;
}) {
  const { db, usersTable } = await getDb();

  const [user] = await db
    .insert(usersTable)
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
 * @param userId - User ID
 */
export async function updateLastLogin(userId: string) {
  const { db, usersTable } = await getDb();
  const { eq } = await import("drizzle-orm");

  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, userId));
}
