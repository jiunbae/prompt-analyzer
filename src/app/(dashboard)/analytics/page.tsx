import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

async function getAnalytics() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    return null;
  }

  try {
    const client = postgres(connectionString);
    const db = drizzle(client, { schema });

    const [stats, dailyStats, projectStats, typeStats, recentPrompts] = await Promise.all([
    // Overall stats
    db
      .select({
        totalPrompts: sql<number>`count(*)`,
        totalTokens: sql<number>`coalesce(sum(token_estimate), 0)`,
        totalChars: sql<number>`coalesce(sum(prompt_length), 0)`,
        uniqueProjects: sql<number>`count(distinct project_name)`,
        avgPromptLength: sql<number>`avg(prompt_length)`,
      })
      .from(schema.prompts),

    // Daily stats for last 30 days (or all time if less data)
    db
      .select({
        date: sql<string>`to_char(timestamp, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)`,
        tokens: sql<number>`coalesce(sum(token_estimate), 0)`,
      })
      .from(schema.prompts)
      .groupBy(sql`to_char(timestamp, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(timestamp, 'YYYY-MM-DD')`)
      .limit(30),

    // Top projects
    db
      .select({
        project: schema.prompts.projectName,
        count: sql<number>`count(*)`,
        tokens: sql<number>`coalesce(sum(token_estimate), 0)`,
      })
      .from(schema.prompts)
      .where(sql`project_name is not null`)
      .groupBy(schema.prompts.projectName)
      .orderBy(desc(sql`count(*)`))
      .limit(10),

    // Prompt types distribution
    db
      .select({
        type: schema.prompts.promptType,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .groupBy(schema.prompts.promptType),

    // Recent activity (last 5 prompts)
    db
      .select({
        id: schema.prompts.id,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        promptLength: schema.prompts.promptLength,
        promptType: schema.prompts.promptType,
      })
      .from(schema.prompts)
      .orderBy(desc(schema.prompts.timestamp))
      .limit(5),
  ]);

    await client.end();

    return {
      stats: stats[0],
      dailyStats,
      projectStats,
      typeStats,
      recentPrompts,
    };
  } catch (error) {
    console.error("Analytics error:", error);
    return null;
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

export default async function AnalyticsPage() {
  const data = await getAnalytics();

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-zinc-400">Unable to load analytics. Check database connection.</p>
      </div>
    );
  }

  const { stats, dailyStats, projectStats, typeStats, recentPrompts } = data;
  const maxDailyCount = Math.max(...dailyStats.map((d) => Number(d.count)), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Analytics</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Insights from your Claude Code usage
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
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-lg text-zinc-100">
            Daily Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-32">
            {dailyStats.map((day, i) => {
              const height = (Number(day.count) / maxDailyCount) * 100;
              const date = new Date(day.date);
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center gap-1"
                  title={`${day.date}: ${day.count} prompts`}
                >
                  <div
                    className="w-full bg-indigo-500 rounded-t transition-all hover:bg-indigo-400"
                    style={{ height: `${Math.max(height, 4)}%` }}
                  />
                  <span className="text-[10px] text-zinc-500">
                    {date.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
          {dailyStats.length === 0 && (
            <p className="text-zinc-500 text-center py-8">No data for the last 14 days</p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Projects */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">Top Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {projectStats.map((project, i) => (
                <div key={i} className="flex items-center justify-between">
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
                  <div key={i} className="space-y-1">
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
