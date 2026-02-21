import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE_NAME = "auth_session";
const MAX_TOKEN_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionPayload {
  userId: string;
  email: string;
  token: string;
  isAdmin: boolean;
}

/**
 * Verify session token HMAC-SHA256 signature using Web Crypto API (Edge-compatible).
 * Mirrors the logic in src/lib/auth.ts parseSessionToken() but avoids importing
 * the Node.js crypto module which is not available in Edge Runtime.
 */
async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return null; // Reject unsigned tokens

    const encoded = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);

    const secret = process.env.SESSION_SECRET || "";
    if (!secret) return null;

    // Import key for HMAC-SHA256
    const keyData = new TextEncoder().encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    // Compute expected signature
    const data = new TextEncoder().encode(encoded);
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, data);

    // Convert to base64url
    const expectedSig = btoa(
      String.fromCharCode(...new Uint8Array(signatureBuffer)),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Constant-time comparison (compare all chars even if mismatch found)
    if (signature.length !== expectedSig.length) return null;
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }
    if (mismatch !== 0) return null;

    // Decode payload
    const payloadJson = atob(
      encoded.replace(/-/g, "+").replace(/_/g, "/"),
    );
    const parsed = JSON.parse(payloadJson);

    if (!parsed.userId || !parsed.email || !parsed.token) return null;

    // Check expiry
    if (parsed.iat && Date.now() - parsed.iat > MAX_TOKEN_AGE_MS) return null;

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

// Routes that don't require authentication
const publicRoutes = [
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/cli-login",
  "/api/auth/register",
  "/api/auth/logout",
  "/share",
  "/api/share",
];

// Routes that accept alternative authentication (X-User-Token header)
const tokenAuthRoutes = ["/api/sync"];

// Routes that require admin access
const adminRoutes = ["/api/admin", "/admin"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Allow token-auth routes if X-User-Token header is present
  if (tokenAuthRoutes.some((route) => pathname.startsWith(route))) {
    const userToken = request.headers.get("X-User-Token");
    if (userToken) {
      // Token will be validated by the route handler
      return NextResponse.next();
    }
    // Fall through to cookie auth if no token header
  }

  // Allow static files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Get auth session cookie
  const sessionToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!sessionToken) {
    // Redirect to login for page requests
    if (!pathname.startsWith("/api/")) {
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
    // Return 401 for API requests
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Parse and verify session token signature (HMAC-SHA256)
  const session = await verifySessionToken(sessionToken);

  if (!session) {
    // Invalid session - redirect to login
    if (!pathname.startsWith("/api/")) {
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  // Check admin routes
  if (adminRoutes.some((route) => pathname.startsWith(route))) {
    if (!session.isAdmin) {
      if (!pathname.startsWith("/api/")) {
        // Redirect non-admins to home
        const homeUrl = new URL("/", request.url);
        return NextResponse.redirect(homeUrl);
      }
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }
  }

  // Add user info to request headers for downstream use
  const requestHeaders = new Headers(request.headers);
  // Used by tRPC context (src/server/trpc.ts)
  requestHeaders.set("x-user-id", session.userId);
  requestHeaders.set("x-user-email", session.email);
  requestHeaders.set("x-user-is-admin", String(session.isAdmin));

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
