import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
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
    const session = await requireAuth();

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
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Session story API error:", error);
    return NextResponse.json(
      { error: "Failed to generate session story" },
      { status: 500 },
    );
  }
}
