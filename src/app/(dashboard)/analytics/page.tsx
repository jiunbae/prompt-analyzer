import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { desc, sql, eq, and, gte, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { TokenUsageChart } from "@/components/charts/token-usage-chart";
import { QualityTrendChart } from "@/components/charts/quality-trend-chart";
import { computeSessions } from "@/lib/session-analysis";
import { ProjectActivityChart } from "@/components/charts/project-activity-chart";
import { SessionChart } from "@/components/charts/session-chart";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { analyzePrompt, summarizePromptReviews } from "@/lib/prompt-insights";

// Force dynamic rendering - don't pre-render at build time
export const dynamic = "force-dynamic";

/**
 * Get current user from session cookie
 */
async function getCurrentUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  return parseSessionToken(sessionToken);
}

function toDateOnlyString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getLastNDays(end: Date, days: number) {
  const base = new Date(end);
  base.setUTCHours(0, 0, 0, 0);

  const result: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    result.push(toDateOnlyString(d));
  }
  return result;
}

async function getAnalytics(userId: string | null) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    return null;
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // Build user filter condition
    const userFilter = userId
      ? eq(schema.prompts.userId, userId)
      : undefined;

    const userProjectFilter = userId
      ? sql`project_name is not null AND user_id = ${userId}`
      : sql`project_name is not null`;

    const rangeTo = new Date();
    const rangeFrom = new Date(rangeTo);
    rangeFrom.setUTCDate(rangeFrom.getUTCDate() - 29);
    rangeFrom.setUTCHours(0, 0, 0, 0);

    const promptInsightsQuery = db
      .select({
        promptText: schema.prompts.promptText,
        promptLength: schema.prompts.promptLength,
      })
      .from(schema.prompts)
      .orderBy(desc(schema.prompts.timestamp))
      .limit(200);

    const promptInsightsPromise = userFilter
      ? promptInsightsQuery.where(userFilter)
      : promptInsightsQuery;

    const dateExpr = sql<string>`date(${schema.prompts.timestamp})`;

    const rangeWhere = and(
      ...(userFilter ? [userFilter] : []),
      gte(schema.prompts.timestamp, rangeFrom),
      lt(schema.prompts.timestamp, rangeTo),
      eq(schema.prompts.promptType, "user_input")
    );

    const [stats, dailySeries, projectStats, typeStats, recentPrompts, promptSamples, projectActivityRows, sessionPromptRows] =
      await Promise.all([
      // Overall stats - filtered by user
      db
        .select({
          totalPrompts: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(token_estimate), 0)`,
          totalChars: sql<number>`coalesce(sum(prompt_length), 0)`,
          uniqueProjects: sql<number>`count(distinct project_name)`,
          avgPromptLength: sql<number>`avg(prompt_length)`,
        })
        .from(schema.prompts)
        .where(userFilter),

      db
        .select({
          date: dateExpr,
          count: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
        })
        .from(schema.prompts)
        .where(rangeWhere)
        .groupBy(dateExpr)
        .orderBy(dateExpr),

      // Top projects - filtered by user
      db
        .select({
          project: schema.prompts.projectName,
          count: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(token_estimate), 0)`,
        })
        .from(schema.prompts)
        .where(userProjectFilter)
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      // Prompt types distribution - filtered by user
      db
        .select({
          type: schema.prompts.promptType,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(userFilter)
        .groupBy(schema.prompts.promptType),

      // Recent activity (last 5 prompts) - filtered by user
      db
        .select({
          id: schema.prompts.id,
          timestamp: schema.prompts.timestamp,
          projectName: schema.prompts.projectName,
          promptLength: schema.prompts.promptLength,
          promptType: schema.prompts.promptType,
        })
        .from(schema.prompts)
        .where(userFilter)
        .orderBy(desc(schema.prompts.timestamp))
        .limit(5),
      promptInsightsPromise,

      // Project activity (last 30d, user_input only)
      db
        .select({
          project: schema.prompts.projectName,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(and(rangeWhere, sql`project_name is not null`))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      // Sessions (last 30d, user_input only)
      db
        .select({
          timestamp: schema.prompts.timestamp,
        })
        .from(schema.prompts)
        .where(rangeWhere)
        .orderBy(schema.prompts.timestamp),
    ]);

    // Quality trend is optional: the table may not exist until migrations are applied.
    let qualityAvailable = false;
    let qualityAverageScore = 0;
    let qualityTrend: Array<{ date: string; score: number }> = [];

    try {
      const [avgRows, trendRows] = await Promise.all([
        db
          .select({
            avgScore: sql<number>`round(avg(${schema.promptReviews.score}))`,
          })
          .from(schema.prompts)
          .innerJoin(
            schema.promptReviews,
            eq(schema.promptReviews.promptId, schema.prompts.id)
          )
          .where(rangeWhere),

        db
          .select({
            date: dateExpr,
            avgScore: sql<number>`round(avg(${schema.promptReviews.score}))`,
          })
          .from(schema.prompts)
          .innerJoin(
            schema.promptReviews,
            eq(schema.promptReviews.promptId, schema.prompts.id)
          )
          .where(rangeWhere)
          .groupBy(dateExpr)
          .orderBy(dateExpr),
      ]);

      qualityAvailable = true;
      qualityAverageScore = Number(avgRows[0]?.avgScore ?? 0);
      qualityTrend = trendRows.map((r) => ({
        date: r.date,
        score: Number(r.avgScore ?? 0),
      }));
    } catch (error) {
      qualityAvailable = false;
      qualityAverageScore = 0;
      qualityTrend = [];
    }

    const promptReviews = promptSamples.map((prompt) =>
      analyzePrompt(prompt.promptText)
    );

    const promptInsights = summarizePromptReviews(promptReviews);

    // Fill last 30d daily series (even if some days have no data)
    const dayKeys = getLastNDays(rangeTo, 30);
    const dailyMap = new Map(
      dailySeries.map((d) => [d.date, { count: Number(d.count ?? 0), tokens: Number(d.tokens ?? 0) }])
    );

    const dailyStats = dayKeys.map((date) => ({
      date,
      count: dailyMap.get(date)?.count ?? 0,
      tokens: dailyMap.get(date)?.tokens ?? 0,
    }));

    // Session analysis (30-minute gap heuristic)
    const sessions = computeSessions(sessionPromptRows);

    const sessionsCount = sessions.length;
    const totalSessionPrompts = sessions.reduce((acc, s) => acc + s.promptCount, 0);
    const totalSessionMinutes = sessions.reduce(
      (acc, s) => acc + (s.end.getTime() - s.start.getTime()) / 60000,
      0
    );

    const sessionSummary = {
      sessions: sessionsCount,
      avgPromptsPerSession: sessionsCount ? Math.round(totalSessionPrompts / sessionsCount) : 0,
      avgSessionMinutes: sessionsCount ? Math.round(totalSessionMinutes / sessionsCount) : 0,
    };

    const sessionsPerDayMap = new Map<string, number>();
    for (const s of sessions) {
      const day = toDateOnlyString(s.start);
      sessionsPerDayMap.set(day, (sessionsPerDayMap.get(day) ?? 0) + 1);
    }

    const sessionsPerDay = dayKeys.map((date) => ({
      date,
      sessions: sessionsPerDayMap.get(date) ?? 0,
    }));

    return {
      stats: stats[0],
      dailyStats,
      projectStats,
      typeStats,
      recentPrompts,
      promptInsights,
      quality: {
        available: qualityAvailable,
        averageScore: qualityAverageScore,
        trend: qualityTrend,
      },
      projectActivity: projectActivityRows.map((p) => ({
        project: p.project ?? "No project",
        count: Number(p.count ?? 0),
      })),
      sessions: {
        summary: sessionSummary,
        perDay: sessionsPerDay,
      },
    };
  } catch (error) {
    console.error("Analytics error:", error);
    return null;
  } finally {
    await client.end();
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function getScoreLabel(score: number) {
  if (score >= 80) return "Strong";
  if (score >= 55) return "Good";
  return "Needs Work";
}

export default async function AnalyticsPage() {
  // Get current user from session
  const user = await getCurrentUser();
  const userId = user?.userId ?? null;

  const data = await getAnalytics(userId);

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-zinc-400">Unable to load analytics. Check database connection.</p>
      </div>
    );
  }

  const { stats, dailyStats, projectStats, typeStats, recentPrompts, promptInsights, quality, projectActivity, sessions } =
    data;

  const averageScoreLabel = getScoreLabel(promptInsights.averageScore);
  const averageScoreVariant =
    averageScoreLabel === "Strong"
      ? "success"
      : averageScoreLabel === "Good"
        ? "secondary"
        : "warning";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Insights</h1>
        <p className="text-sm text-zinc-400 mt-1">
          See how you prompt and where to improve
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Total Prompts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-100">
              {formatNumber(Number(stats?.totalPrompts ?? 0))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Est. Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-100">
              {formatNumber(Number(stats?.totalTokens ?? 0))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-100">
              {Number(stats?.uniqueProjects ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Avg Length
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-100">
              {formatNumber(Math.round(Number(stats?.avgPromptLength ?? 0)))}
            </div>
            <p className="text-xs text-zinc-500">characters</p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Activity Chart */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">
              Activity Heatmap
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityHeatmap 
              data={dailyStats.map(d => ({ 
                date: d.date, 
                count: Number(d.count ?? 0) 
              }))} 
            />
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">
              Token Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TokenUsageChart 
              data={dailyStats.map(d => ({ 
                date: d.date, 
                tokens: Number(d.tokens ?? 0) 
              }))} 
            />
          </CardContent>
        </Card>
      </div>

      {/* Quality / Projects / Sessions */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">Quality Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {!quality.available ? (
              <div className="py-8 text-center text-zinc-500 text-sm">
                Quality trends are unavailable until `prompt_reviews` is created.
              </div>
            ) : quality.trend.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-sm">
                No prompt reviews found for the last 30 days.
              </div>
            ) : (
              <div>
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs text-zinc-500">Avg score (30d)</div>
                    <div className="text-2xl font-semibold text-zinc-100">
                      {quality.averageScore}
                    </div>
                  </div>
                </div>
                <QualityTrendChart
                  data={quality.trend.map((d) => ({ date: d.date, score: d.score }))}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">Project Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {projectActivity.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-sm">
                No project activity in the last 30 days.
              </div>
            ) : (
              <ProjectActivityChart
                data={projectActivity.map((p) => ({
                  project: p.project,
                  count: p.count,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.summary.sessions === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-sm">
                Not enough activity to analyze sessions.
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                    <div className="text-xs text-zinc-500">Sessions (30d)</div>
                    <div className="text-zinc-100 font-medium">
                      {sessions.summary.sessions}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                    <div className="text-xs text-zinc-500">Avg prompts</div>
                    <div className="text-zinc-100 font-medium">
                      {sessions.summary.avgPromptsPerSession}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                    <div className="text-xs text-zinc-500">Avg minutes</div>
                    <div className="text-zinc-100 font-medium">
                      {sessions.summary.avgSessionMinutes}
                    </div>
                  </div>
                </div>
                <SessionChart data={sessions.perDay} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Prompt Improvement */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Prompt Improvement</h2>
          <p className="text-sm text-zinc-400">
            Based on your most recent {promptInsights.total} prompts
          </p>
        </div>
        {promptInsights.total === 0 ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="py-8 text-center text-zinc-500">
              Not enough prompts yet to generate insights.
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-lg text-zinc-100">Prompt Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-semibold text-zinc-100">
                    {promptInsights.averageScore}
                  </span>
                  <Badge variant={averageScoreVariant}>{averageScoreLabel}</Badge>
                </div>
                <div className="text-sm text-zinc-400 space-y-1">
                  <div className="flex items-center justify-between">
                    <span>Average words</span>
                    <span className="text-zinc-200">
                      {promptInsights.length.averageWords}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Short prompts</span>
                    <span className="text-zinc-200">
                      {promptInsights.length.shortCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Long prompts</span>
                    <span className="text-zinc-200">
                      {promptInsights.length.longCount}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-lg text-zinc-100">Signal Coverage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {promptInsights.signalStats.map((stat) => (
                  <div key={stat.id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-300">{stat.label}</span>
                      <span className="text-zinc-500">{stat.percent}%</span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500/80 rounded-full"
                        style={{ width: `${stat.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-lg text-zinc-100">Top Gaps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-zinc-300">
                {promptInsights.topGaps.length === 0 ? (
                  <p className="text-zinc-500">Great coverage across key signals.</p>
                ) : (
                  promptInsights.topGaps.map((gap) => (
                    <div
                      key={gap.id}
                      className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2"
                    >
                      <span>{gap.label}</span>
                      <span className="text-zinc-500">{gap.percent}%</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Projects */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">Top Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {projectStats.map((project, i) => (
                <div key={project.project || i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 text-sm w-4">{i + 1}.</span>
                    <span className="text-zinc-200 font-medium">
                      {project.project}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400 text-sm">
                      {formatNumber(Number(project.tokens))} tokens
                    </span>
                    <Badge variant="secondary">{project.count}</Badge>
                  </div>
                </div>
              ))}
              {projectStats.length === 0 && (
                <p className="text-zinc-500 text-center py-4">No project data</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Prompt Types */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">Prompt Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {typeStats.map((type, i) => {
                const total = typeStats.reduce((acc, t) => acc + Number(t.count), 0);
                const percentage = total > 0 ? (Number(type.count) / total) * 100 : 0;
                const label =
                  type.type === "user_input"
                    ? "User Input"
                    : type.type === "task_notification"
                    ? "Task Notification"
                    : type.type === "system"
                    ? "System"
                    : type.type ?? "Unknown";

                return (
                  <div key={type.type || i} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-300">{label}</span>
                      <span className="text-zinc-400">
                        {type.count} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-lg text-zinc-100">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentPrompts.map((prompt) => (
              <div
                key={prompt.id}
                className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <div>
                    <p className="text-zinc-200 text-sm">
                      {prompt.projectName ?? "No project"}
                    </p>
                    <p className="text-zinc-500 text-xs">
                      {formatDate(prompt.timestamp)}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={
                    prompt.promptType === "user_input"
                      ? "default"
                      : prompt.promptType === "task_notification"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {prompt.promptLength} chars
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
