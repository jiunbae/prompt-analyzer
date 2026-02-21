import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

// GET /api/share/[token] - Public endpoint, no auth required
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Find the shared prompt
    const [shared] = await db
      .select()
      .from(schema.sharedPrompts)
      .where(
        and(
          eq(schema.sharedPrompts.shareToken, token),
          eq(schema.sharedPrompts.isActive, true)
        )
      )
      .limit(1);

    if (!shared) {
      return NextResponse.json(
        { error: "Share link not found or has been revoked" },
        { status: 404 }
      );
    }

    // Check expiry
    if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 410 }
      );
    }

    // Fetch the prompt
    const [prompt] = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        responseText: schema.prompts.responseText,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        source: schema.prompts.source,
        promptType: schema.prompts.promptType,
        qualityScore: schema.prompts.qualityScore,
        tokenEstimate: schema.prompts.tokenEstimate,
        tokenEstimateResponse: schema.prompts.tokenEstimateResponse,
      })
      .from(schema.prompts)
      .where(eq(schema.prompts.id, shared.promptId))
      .limit(1);

    if (!prompt) {
      return NextResponse.json(
        { error: "The shared prompt no longer exists" },
        { status: 404 }
      );
    }

    // Increment view count
    await db
      .update(schema.sharedPrompts)
      .set({ viewCount: sql`${schema.sharedPrompts.viewCount} + 1` })
      .where(eq(schema.sharedPrompts.id, shared.id));

    return NextResponse.json({
      prompt: {
        ...prompt,
        sharedAt: shared.createdAt,
      },
    });
  } catch (error) {
    console.error("Share [token] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch shared prompt" },
      { status: 500 }
    );
  }
}
