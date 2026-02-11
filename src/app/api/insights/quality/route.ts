import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { handler as enrichHandler } from "@/extensions/prompt-quality/processor";

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

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

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

    // Build distribution map
    const distMap: Record<string, number> = { low: 0, medium: 0, good: 0, excellent: 0 };
    for (const row of distributionRows) {
      const bucket = (row.bucket as string).trim();
      distMap[bucket] = Number(row.count);
    }

    // Build topic array
    const topTopics = (topicRows as Array<{ tag: string; count: number }>).map(
      (r) => ({ tag: r.tag, count: Number(r.count) }),
    );

    return NextResponse.json({
      averageScore: Math.round(Number(stats?.averageScore ?? 0)),
      totalEnriched: Number(stats?.totalEnriched ?? 0),
      totalUnenriched: Number(stats?.totalUnenriched ?? 0),
      distribution: distMap,
      topTopics,
    });
  } catch (error) {
    console.error("Quality insights API error:", error);
    return NextResponse.json(
      { error: "Failed to load quality insights" },
      { status: 500 },
    );
  } finally {
    await client.end();
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
