import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE_NAME = "auth_session";

// Routes that don't require authentication
const publicRoutes = [
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
];

// Routes that accept alternative authentication (X-User-Token header)
const tokenAuthRoutes = ["/api/sync"];

// Routes that require admin access
const adminRoutes = ["/api/admin", "/admin"];

export function middleware(request: NextRequest) {
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

  // Parse session token
  let session: {
    userId: string;
    email: string;
    token: string;
    isAdmin: boolean;
  } | null = null;

  try {
    const data = Buffer.from(sessionToken, "base64").toString("utf-8");
    const parsed = JSON.parse(data);

    if (parsed.userId && parsed.email && parsed.token) {
      session = {
        userId: parsed.userId,
        email: parsed.email,
        token: parsed.token,
        isAdmin: parsed.isAdmin ?? false,
      };
    }
  } catch {
    // Invalid session token
  }

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
        { status: 403 }
      );
    }
  }

  // Add user info to request headers for downstream use
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", session.userId);
  requestHeaders.set("x-user-email", session.email);
  requestHeaders.set("x-user-token", session.token);
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
