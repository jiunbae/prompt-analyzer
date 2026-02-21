import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { computeSimilarity } from "@/lib/prompt-diff";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const parsedLimit = parseInt(searchParams.get("limit") ?? "5", 10);
    const limit = Number.isNaN(parsedLimit) ? 5 : Math.max(1, Math.min(parsedLimit, 50));

    if (!id) {
      return NextResponse.json(
        { error: "Prompt 'id' is required" },
        { status: 400 }
      );
    }

    // Fetch the source prompt
    const ownershipCondition = session.isAdmin
      ? eq(schema.prompts.id, id)
      : and(eq(schema.prompts.id, id), eq(schema.prompts.userId, session.userId));

    const [sourcePrompt] = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        projectName: schema.prompts.projectName,
        sessionId: schema.prompts.sessionId,
        userId: schema.prompts.userId,
        searchVector: schema.prompts.searchVector,
      })
      .from(schema.prompts)
      .where(ownershipCondition)
      .limit(1);

    if (!sourcePrompt) {
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
    }

    // Use PostgreSQL ts_rank with search_vector for fast similarity search.
    // We extract significant words from the prompt to build a tsquery,
    // then rank matching prompts by relevance.
    const words = sourcePrompt.promptText
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 15);

    if (words.length === 0) {
      return NextResponse.json({ prompts: [] });
    }

    const searchText = words.join(" ");

    // Build ownership filter for candidates
    const userFilter = session.isAdmin
      ? sql`TRUE`
      : sql`${schema.prompts.userId} = ${session.userId}`;

    const candidates = await db
      .select({
        id: schema.prompts.id,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        promptText: schema.prompts.promptText,
        rank: sql<number>`ts_rank(${schema.prompts.searchVector}, plainto_tsquery('english', ${searchText}))`,
      })
      .from(schema.prompts)
      .where(
        and(
          ne(schema.prompts.id, id),
          sql`${schema.prompts.searchVector} @@ plainto_tsquery('english', ${searchText})`,
          sql`${userFilter}`
        )
      )
      .orderBy(
        sql`ts_rank(${schema.prompts.searchVector}, plainto_tsquery('english', ${searchText})) DESC`
      )
      .limit(limit * 3); // Fetch extra to re-rank with Jaccard

    // Re-rank candidates using a combined score: 50% Jaccard + 50% normalised ts_rank
    const maxRank = Math.max(...candidates.map((c) => c.rank), 0.001);
    const ranked = candidates
      .map((c) => {
        const jaccard = computeSimilarity(sourcePrompt.promptText, c.promptText);
        const normRank = c.rank / maxRank;
        return {
          id: c.id,
          timestamp: c.timestamp,
          projectName: c.projectName,
          similarity: 0.5 * jaccard + 0.5 * normRank,
          firstLine: c.promptText.split("\n")[0].slice(0, 120),
        };
      })
      .filter((c) => c.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return NextResponse.json({ prompts: ranked });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Similar prompts API error:", error);
    return NextResponse.json(
      { error: "Failed to find similar prompts" },
      { status: 500 }
    );
  }
}
