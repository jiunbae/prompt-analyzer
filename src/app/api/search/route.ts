import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";

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

    const postgresModule = await import("postgres");
    const client = postgresModule.default(process.env.DATABASE_URL!);

    try {
      let rows: Record<string, unknown>[];

      if (mode === "keyword") {
        rows = await client`
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
        `;
      } else if (mode === "semantic") {
        // Set threshold so the % operator uses the GIN trigram index
        await client`SET pg_trgm.similarity_threshold = 0.1`;
        rows = await client`
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
          ORDER BY similarity(prompt_text, ${query}) DESC
          LIMIT ${limit}
        `;
      } else {
        // hybrid mode: combine keyword and trigram scores
        // Set threshold so the % operator uses the GIN trigram index
        await client`SET pg_trgm.similarity_threshold = 0.1`;
        rows = await client`
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
              OR prompt_text % ${query}
            )
          ORDER BY score DESC
          LIMIT ${limit}
        `;
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
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
