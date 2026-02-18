import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { handler as enrichHandler } from "@/extensions/prompt-quality/processor";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
function getDb() {
  if (!db) {
    const client = postgres(process.env.DATABASE_URL!);
    db = drizzle(client, { schema });
  }
  return db;
}

async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  const session = parseSessionToken(sessionToken);
  if (!session) return null;
  return session.userId;
}

/**
 * GET /api/insights/quality
 * Returns quality stats for the authenticated user.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = getDb();

  try {
    const [
      overallStats,
      distributionRows,
      topicRows,
    ] = await Promise.all([
      // Overall averages
      db
        .select({
          averageScore: sql<number>`coalesce(avg(quality_score), 0)`,
          averageClarity: sql<number>`coalesce(avg(quality_clarity), 0)`,
          averageSpecificity: sql<number>`coalesce(avg(quality_specificity), 0)`,
          averageContext: sql<number>`coalesce(avg(quality_context), 0)`,
          averageConstraints: sql<number>`coalesce(avg(quality_constraints), 0)`,
          averageStructure: sql<number>`coalesce(avg(quality_structure), 0)`,
          totalEnriched: sql<number>`count(*) filter (where enriched_at is not null)`,
          totalUnenriched: sql<number>`count(*) filter (where enriched_at is null and prompt_type = 'user_input')`,
        })
        .from(schema.prompts)
        .where(eq(schema.prompts.userId, userId)),

      // Quality distribution
      db
        .select({
          bucket: sql<string>`
            case
              when quality_score <= 25 then 'low'
              when quality_score <= 50 then 'medium'
              when quality_score <= 75 then 'good'
              else 'excellent'
            end
          `,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(
          and(
            eq(schema.prompts.userId, userId),
            sql`${schema.prompts.enrichedAt} is not null`,
          ),
        )
        .groupBy(
          sql`case
            when quality_score <= 25 then 'low'
            when quality_score <= 50 then 'medium'
            when quality_score <= 75 then 'good'
            else 'excellent'
          end`,
        ),

      // Top topic tags (unnest the array and count)
      db.execute(sql`
        select tag, count(*)::int as count
        from ${schema.prompts}, unnest(topic_tags) as tag
        where ${schema.prompts.userId} = ${userId}
          and ${schema.prompts.enrichedAt} is not null
        group by tag
        order by count desc
        limit 15
      `),
    ]);

    const stats = overallStats[0];
    const dimensions = {
      clarity: Math.round(Number(stats?.averageClarity ?? 0)),
      specificity: Math.round(Number(stats?.averageSpecificity ?? 0)),
      context: Math.round(Number(stats?.averageContext ?? 0)),
      constraints: Math.round(Number(stats?.averageConstraints ?? 0)),
      structure: Math.round(Number(stats?.averageStructure ?? 0)),
    };

    const improvementTips: Record<keyof typeof dimensions, string> = {
      clarity: "State the exact goal and desired outcome in one sentence.",
      specificity: "Add concrete references like files, functions, and numeric targets.",
      context: "Include current behavior and why the request matters.",
      constraints: "List boundaries explicitly (must, should not, avoid, limits).",
      structure: "Use bullets or sections to separate goals and requirements.",
    };

    const topImprovements = (Object.entries(dimensions) as Array<
      [keyof typeof dimensions, number]
    >)
      .sort(([, a], [, b]) => a - b)
      .filter(([, score]) => score < 75)
      .slice(0, 3)
      .map(([dimension, score]) => ({
        dimension,
        score,
        suggestion: improvementTips[dimension],
      }));

    // Build distribution map
    const distMap: Record<string, number> = { low: 0, medium: 0, good: 0, excellent: 0 };
    for (const row of distributionRows) {
      const bucket = (row.bucket as string).trim();
      distMap[bucket] = Number(row.count);
    }

    // Build topic array
    const topTopics = (topicRows as unknown as Array<{ tag: string; count: number }>).map(
      (r) => ({ tag: r.tag, count: Number(r.count) }),
    );

    return NextResponse.json({
      averageScore: Math.round(Number(stats?.averageScore ?? 0)),
      totalEnriched: Number(stats?.totalEnriched ?? 0),
      totalUnenriched: Number(stats?.totalUnenriched ?? 0),
      distribution: distMap,
      dimensions,
      topImprovements,
      topTopics,
    });
  } catch (error) {
    console.error("Quality insights API error:", error);
    return NextResponse.json(
      { error: "Failed to load quality insights" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/insights/quality
 * Triggers batch enrichment for the authenticated user.
 */
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await enrichHandler({
      userId,
      dateRange: {
        from: thirtyDaysAgo.toISOString(),
        to: now.toISOString(),
      },
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Quality enrichment trigger error:", error);
    return NextResponse.json(
      { error: "Failed to run enrichment" },
      { status: 500 },
    );
  }
}
