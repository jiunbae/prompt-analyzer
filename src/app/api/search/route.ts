import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type SearchMode = "keyword" | "semantic" | "hybrid";

interface SearchResult {
  id: string;
  timestamp: string;
  projectName: string | null;
  promptText: string;
  source: string | null;
  sessionId: string | null;
  score: number;
  matchType: SearchMode;
}

/**
 * GET /api/search?q=<query>&mode=keyword|semantic|hybrid&limit=20
 *
 * mode=keyword: existing tsvector full-text search (websearch_to_tsquery)
 * mode=semantic: pg_trgm trigram similarity (similarity(prompt_text, query) > 0.1)
 * mode=hybrid: combine both with weighted scores (0.4 * keyword + 0.6 * trigram)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const rateCheck = rateLimiters.search(session.userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    const mode = (searchParams.get("mode") || "hybrid") as SearchMode;
    const parsedLimit = parseInt(searchParams.get("limit") ?? "20", 10);

    if (!query) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    if (!["keyword", "semantic", "hybrid"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode. Use: keyword, semantic, or hybrid" }, { status: 400 });
    }

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return NextResponse.json({ error: "Invalid limit. Must be between 1 and 100" }, { status: 400 });
    }
    const limit = parsedLimit;

    let rows: Record<string, unknown>[];

    if (mode === "keyword") {
      rows = await db.execute(sql`
        SELECT
          id,
          timestamp,
          project_name,
          LEFT(prompt_text, 300) as prompt_text,
          source,
          session_id,
          ts_rank(search_vector, websearch_to_tsquery('english', ${query})) as score
        FROM prompts
        WHERE user_id = ${session.userId}
          AND search_vector @@ websearch_to_tsquery('english', ${query})
        ORDER BY score DESC
        LIMIT ${limit}
      `) as unknown as Record<string, unknown>[];
    } else if (mode === "semantic") {
      rows = await db.execute(sql`
        SELECT
          id,
          timestamp,
          project_name,
          LEFT(prompt_text, 300) as prompt_text,
          source,
          session_id,
          similarity(prompt_text, ${query}) as score
        FROM prompts
        WHERE user_id = ${session.userId}
          AND prompt_text % ${query}
          AND similarity(prompt_text, ${query}) > 0.1
        ORDER BY similarity(prompt_text, ${query}) DESC
        LIMIT ${limit}
      `) as unknown as Record<string, unknown>[];
    } else {
      // hybrid mode: combine keyword and trigram scores
      rows = await db.execute(sql`
        SELECT
          id,
          timestamp,
          project_name,
          LEFT(prompt_text, 300) as prompt_text,
          source,
          session_id,
          (
            0.4 * (ts_rank(search_vector, websearch_to_tsquery('english', ${query})) / (1.0 + ts_rank(search_vector, websearch_to_tsquery('english', ${query})))) +
            0.6 * COALESCE(similarity(prompt_text, ${query}), 0)
          ) as score
        FROM prompts
        WHERE user_id = ${session.userId}
          AND (
            search_vector @@ websearch_to_tsquery('english', ${query})
            OR (prompt_text % ${query} AND similarity(prompt_text, ${query}) > 0.1)
          )
        ORDER BY score DESC
        LIMIT ${limit}
      `) as unknown as Record<string, unknown>[];
    }

    const results: SearchResult[] = rows.map((row) => ({
      id: row.id as string,
      timestamp: String(row.timestamp),
      projectName: row.project_name as string | null,
      promptText: row.prompt_text as string,
      source: row.source as string | null,
      sessionId: row.session_id as string | null,
      score: Number(row.score),
      matchType: mode,
    }));

    return NextResponse.json({
      results,
      mode,
      totalResults: results.length,
      query,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Search API error");
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
