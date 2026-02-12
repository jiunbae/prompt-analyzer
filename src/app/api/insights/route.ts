import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import {
  getCachedInsight,
  getUserInsights,
  cacheInsight,
  hashData,
} from "@/extensions/insight-cache";
import { getExtension } from "@/extensions/registry";
import type { InsightResult } from "@/extensions/types";

async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  const session = parseSessionToken(sessionToken);
  if (!session) return null;
  return session.userId;
}

/**
 * GET /api/insights
 * Returns all cached insights for the authenticated user.
 * Optional query param: ?type=daily-summary to get a specific insight.
 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  try {
    if (type) {
      const insight = await getCachedInsight(userId, type);
      return NextResponse.json({ insight });
    }

    const insights = await getUserInsights(userId);
    return NextResponse.json({ insights });
  } catch (error) {
    console.error("Insights GET error:", error);
    return NextResponse.json(
      { error: "Failed to load insights" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/insights
 * Generates a new insight on-demand.
 * Body: { type: string, dateRange?: { from: string, to: string } }
 */
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, dateRange } = body as {
      type?: string;
      dateRange?: { from: string; to: string };
    };

    if (!type || typeof type !== "string") {
      return NextResponse.json(
        { error: "Missing required field: type" },
        { status: 400 },
      );
    }

    const ext = getExtension(type);
    if (!ext?.processor) {
      return NextResponse.json(
        { error: `Extension "${type}" not found or has no processor` },
        { status: 404 },
      );
    }

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 7);

    const resolvedRange = dateRange || {
      from: defaultFrom.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    };

    const processorInput = {
      userId,
      dateRange: resolvedRange,
    };

    const result: InsightResult = await ext.processor.handler(processorInput);

    await cacheInsight(userId, type, result, {
      dataHash: hashData(processorInput),
      ttlHours: ext.cacheTtlHours ?? 24,
    });

    return NextResponse.json({ insight: result });
  } catch (error) {
    console.error("Insights POST error:", error);
    return NextResponse.json(
      { error: "Failed to generate insight" },
      { status: 500 },
    );
  }
}
