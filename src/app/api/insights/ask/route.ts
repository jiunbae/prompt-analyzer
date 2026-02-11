import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { callLLM, getLLMConfig } from "@/extensions/llm";
import type { InsightResult } from "@/extensions/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }
    if (question.length > 500) {
      return NextResponse.json({ error: "Question too long (max 500 chars)" }, { status: 400 });
    }

    const llmConfig = getLLMConfig();
    if (!llmConfig) {
      return NextResponse.json(
        { error: "LLM not configured. Set OMP_LLM_PROVIDER and OMP_LLM_API_KEY environment variables." },
        { status: 503 },
      );
    }

    // Fetch user's prompt data for context
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = await import("postgres");
    const schema = await import("@/db/schema");
    const { eq, and, gte, sql, desc } = await import("drizzle-orm");

    const client = postgres.default(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const baseConditions = and(
        eq(schema.prompts.userId, session.userId),
        gte(schema.prompts.timestamp, thirtyDaysAgo),
      );

      // Gather aggregated stats in parallel
      const [
        totalCountResult,
        projectsResult,
        dailySummaryResult,
        dateRangeResult,
        recentSessionsResult,
      ] = await Promise.all([
        // Total prompts in last 30 days
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.prompts)
          .where(baseConditions),

        // Top projects with counts
        db
          .select({
            name: schema.prompts.projectName,
            count: sql<number>`count(*)::int`,
            tokens: sql<number>`sum(coalesce(${schema.prompts.tokenEstimate}, 0) + coalesce(${schema.prompts.tokenEstimateResponse}, 0))::int`,
          })
          .from(schema.prompts)
          .where(and(baseConditions, sql`${schema.prompts.projectName} IS NOT NULL`))
          .groupBy(schema.prompts.projectName)
          .orderBy(desc(sql`count(*)`))
          .limit(10),

        // Daily summaries for last 7 days
        db.execute(sql`
          SELECT
            date_trunc('day', ${schema.prompts.timestamp})::date as day,
            count(*)::int as prompt_count,
            count(distinct ${schema.prompts.sessionId})::int as session_count,
            count(distinct ${schema.prompts.projectName})::int as project_count,
            sum(coalesce(${schema.prompts.tokenEstimate}, 0) + coalesce(${schema.prompts.tokenEstimateResponse}, 0))::int as total_tokens
          FROM ${schema.prompts}
          WHERE ${and(
            eq(schema.prompts.userId, session.userId),
            gte(schema.prompts.timestamp, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
          )}
          GROUP BY date_trunc('day', ${schema.prompts.timestamp})::date
          ORDER BY day DESC
        `),

        // Date range
        db
          .select({
            minDate: sql<string>`min(${schema.prompts.timestamp})::text`,
            maxDate: sql<string>`max(${schema.prompts.timestamp})::text`,
          })
          .from(schema.prompts)
          .where(baseConditions),

        // Recent sessions
        db.execute(sql`
          SELECT
            ${schema.prompts.sessionId} as session_id,
            (array_agg(${schema.prompts.projectName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as project_name,
            count(*)::int as prompt_count,
            min(${schema.prompts.timestamp}) as started_at,
            max(${schema.prompts.timestamp}) as ended_at
          FROM ${schema.prompts}
          WHERE ${and(
            baseConditions,
            sql`${schema.prompts.sessionId} IS NOT NULL`,
          )}
          GROUP BY ${schema.prompts.sessionId}
          ORDER BY max(${schema.prompts.timestamp}) DESC
          LIMIT 10
        `),
      ]);

      const totalCount = totalCountResult[0]?.count ?? 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dailyRows = ((dailySummaryResult as any).rows ?? dailySummaryResult) as Record<string, unknown>[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionRows = ((recentSessionsResult as any).rows ?? recentSessionsResult) as Record<string, unknown>[];

      const dataContext = {
        total_prompts_30d: totalCount,
        date_range: {
          from: dateRangeResult[0]?.minDate || "N/A",
          to: dateRangeResult[0]?.maxDate || "N/A",
        },
        top_projects: projectsResult.map((p) => ({
          name: p.name,
          prompt_count: p.count,
          total_tokens: p.tokens,
        })),
        daily_summaries_7d: dailyRows.map((d) => ({
          date: d.day,
          prompts: d.prompt_count,
          sessions: d.session_count,
          projects: d.project_count,
          tokens: d.total_tokens,
        })),
        recent_sessions: sessionRows.map((s) => ({
          session_id: s.session_id,
          project: s.project_name,
          prompts: s.prompt_count,
          started_at: s.started_at,
          ended_at: s.ended_at,
        })),
      };

      const response = await callLLM(
        [
          {
            role: "system",
            content: `You are an AI analyst for a developer productivity tool called "Oh My Prompt". Users ask natural language questions about their prompt/coding assistant history.

You MUST return ONLY valid JSON in this exact format:
{
  "title": "Short answer title (max 60 chars)",
  "summary": "2-3 sentence answer to the user's question based on the data",
  "highlights": [
    { "label": "Stat Name", "value": "stat value" }
  ],
  "trends": [
    { "metric": "metric name", "direction": "up|down|stable", "magnitude": 0.5, "explanation": "brief explanation" }
  ],
  "recommendations": [
    "Optional actionable suggestion"
  ],
  "confidence": 0.8
}

Guidelines:
- Answer the question directly and specifically
- Use the provided data to back up your answer with numbers
- Highlights should show 3-6 key data points relevant to the question
- Trends are optional, include only if the question is about changes over time
- Recommendations are optional, include only if genuinely helpful
- Confidence should reflect how well the available data answers the question (0-1)
- If data is insufficient to answer, say so honestly and set confidence low
- Do NOT include any text outside the JSON object
- Do NOT make up data that isn't in the context`,
          },
          {
            role: "user",
            content: `User's question: "${question}"

Here is the user's prompt history data (last 30 days):

${JSON.stringify(dataContext, null, 2)}`,
          },
        ],
        llmConfig,
      );

      const parsed = JSON.parse(response.content);

      const result: InsightResult = {
        title: parsed.title || "Query Result",
        summary: parsed.summary || "Unable to generate response.",
        highlights: parsed.highlights || [],
        trends: parsed.trends || [],
        recommendations: parsed.recommendations || [],
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        generatedAt: new Date().toISOString(),
      };

      return NextResponse.json(result);
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("Ask data API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
