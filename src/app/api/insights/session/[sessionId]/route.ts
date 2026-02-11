import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { handler as sessionStoryHandler } from "@/extensions/session-story/processor";
import {
  getCachedInsight,
  cacheInsight,
  hashData,
} from "@/extensions/insight-cache";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
    }

    // Check cache first
    const cacheKey = `session-story:${sessionId}`;
    const cached = await getCachedInsight(session.userId, cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Generate fresh session story
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await sessionStoryHandler({
      userId: session.userId,
      dateRange: {
        from: thirtyDaysAgo.toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
      },
      parameters: { sessionId },
    });

    // Cache the result (24 hours)
    await cacheInsight(session.userId, cacheKey, result, {
      parameters: { sessionId },
      dataHash: hashData({ sessionId, userId: session.userId }),
      ttlHours: 24,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Session story API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
