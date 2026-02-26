import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import {
  getCachedInsight,
  getUserInsights,
  cacheInsight,
  hashData,
} from "@/extensions/insight-cache";
import { getExtension } from "@/extensions/registry";
import type { InsightResult } from "@/extensions/types";

/**
 * GET /api/insights
 * Returns all cached insights for the authenticated user.
 * Optional query param: ?type=daily-summary to get a specific insight.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (type) {
      const insight = await getCachedInsight(session.userId, type);
      return NextResponse.json({ insight });
    }

    const insights = await getUserInsights(session.userId);
    return NextResponse.json({ insights });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Insights GET error");
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
  try {
    const session = await requireAuth();

    const rl = rateLimiters.llm(session.userId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

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
      userId: session.userId,
      dateRange: resolvedRange,
    };

    const result: InsightResult = await ext.processor.handler(processorInput);

    await cacheInsight(session.userId, type, result, {
      dataHash: hashData(processorInput),
      ttlHours: ext.cacheTtlHours ?? 24,
    });

    return NextResponse.json({ insight: result });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Insights POST error");
    return NextResponse.json(
      { error: "Failed to generate insight" },
      { status: 500 },
    );
  }
}
