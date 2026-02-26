import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await requireAuth();

    const { sessionId } = await params;

    const prompts = await db.query.prompts.findMany({
      where: and(
        eq(schema.prompts.userId, session.userId),
        eq(schema.prompts.sessionId, sessionId)
      ),
      orderBy: [desc(schema.prompts.timestamp)],
      with: {
        promptTags: {
          with: {
            tag: true,
          },
        },
      },
    });

    if (prompts.length === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const newest = prompts[0];
    const oldest = prompts[prompts.length - 1];

    return NextResponse.json({
      sessionId,
      projectName: oldest.projectName,
      source: oldest.source,
      deviceName: newest.deviceName,
      workingDirectory: newest.workingDirectory,
      startedAt: oldest.timestamp,
      endedAt: newest.timestamp,
      prompts: prompts.map((p) => ({
        id: p.id,
        timestamp: p.timestamp,
        promptText: p.promptText,
        responseText: p.responseText,
        promptLength: p.promptLength,
        responseLength: p.responseLength,
        tokenEstimate: p.tokenEstimate,
        tokenEstimateResponse: p.tokenEstimateResponse,
        promptType: p.promptType,
        tags: p.promptTags.map((pt) => pt.tag),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Session detail API error");
    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 }
    );
  }
}
