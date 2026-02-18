import { NextRequest, NextResponse } from "next/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { computeDiff, computeSimilarity } from "@/lib/prompt-diff";

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const idA = searchParams.get("a");
    const idB = searchParams.get("b");

    if (!idA || !idB) {
      return NextResponse.json(
        { error: "Both 'a' and 'b' prompt IDs are required" },
        { status: 400 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 }
      );
    }

    const client = postgres(connectionString);
    const db = drizzle(client, { schema });

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

    await client.end();

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
    console.error("Diff API error:", error);
    return NextResponse.json(
      { error: "Failed to compute diff" },
      { status: 500 }
    );
  }
}
