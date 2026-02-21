import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { computeDiff, computeSimilarity } from "@/lib/prompt-diff";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const idA = searchParams.get("a");
    const idB = searchParams.get("b");

    if (!idA || !idB) {
      return NextResponse.json(
        { error: "Both 'a' and 'b' prompt IDs are required" },
        { status: 400 }
      );
    }

    // Fetch both prompts with ownership check (admins can see all)
    const ownershipCondition = session.isAdmin
      ? inArray(schema.prompts.id, [idA, idB])
      : and(
          inArray(schema.prompts.id, [idA, idB]),
          eq(schema.prompts.userId, session.userId)
        );

    const results = await db
      .select({
        id: schema.prompts.id,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        promptText: schema.prompts.promptText,
        qualityScore: schema.prompts.qualityScore,
      })
      .from(schema.prompts)
      .where(ownershipCondition);

    const promptA = results.find((r) => r.id === idA);
    const promptB = results.find((r) => r.id === idB);

    if (!promptA || !promptB) {
      return NextResponse.json(
        { error: "One or both prompts not found" },
        { status: 404 }
      );
    }

    const diff = computeDiff(promptA.promptText, promptB.promptText);
    const similarity = computeSimilarity(promptA.promptText, promptB.promptText);

    return NextResponse.json({
      promptA: {
        id: promptA.id,
        timestamp: promptA.timestamp,
        projectName: promptA.projectName,
        promptText: promptA.promptText,
        qualityScore: promptA.qualityScore,
      },
      promptB: {
        id: promptB.id,
        timestamp: promptB.timestamp,
        projectName: promptB.projectName,
        promptText: promptB.promptText,
        qualityScore: promptB.qualityScore,
      },
      diff,
      similarity,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Diff API error:", error);
    return NextResponse.json(
      { error: "Failed to compute diff" },
      { status: 500 }
    );
  }
}
