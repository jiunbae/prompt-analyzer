import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
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

    const first = prompts[0];
    const last = prompts[prompts.length - 1];

    return NextResponse.json({
      sessionId,
      projectName: first.projectName,
      source: first.source,
      deviceName: first.deviceName,
      workingDirectory: first.workingDirectory,
      startedAt: first.timestamp,
      endedAt: last.timestamp,
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
    console.error("Session detail API error:", error);
    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 }
    );
  }
}
