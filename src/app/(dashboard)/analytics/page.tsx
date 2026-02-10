import { cookies } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { TokenUsageChart } from "@/components/charts/token-usage-chart";
import { ProjectActivityChart } from "@/components/charts/project-activity-chart";
import { SessionChart } from "@/components/charts/session-chart";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { getAnalytics, formatNumber } from "@/lib/analytics";

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


function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export default async function AnalyticsPage() {
  // Get current user from session
  const user = await getCurrentUser();
  const userId = user?.userId ?? null;

  const data = await getAnalytics(userId);

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Unable to load analytics. Check database connection.</p>
      </div>
    );
  }

  const { stats, responseStats, dailyStats, projectStats, typeStats, recentPrompts, projectActivity, sessions } =
    data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Insights</h1>
        <p className="text-sm text-muted-foreground mt-1">
          See how you prompt and where to improve
        </p>
      </div>

      {/* User Prompt Stats */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
          User Prompts
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Prompts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(Number(stats?.totalPrompts ?? 0))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Input Tokens
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(Number(stats?.totalTokens ?? 0))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {Number(stats?.uniqueProjects ?? 0)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg Length
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(Math.round(Number(stats?.avgPromptLength ?? 0)))}
              </div>
              <p className="text-xs text-muted-foreground">characters</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Agent Response Stats */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
          Agent Responses
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Responses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(responseStats.totalResponses)}
              </div>
              <p className="text-xs text-muted-foreground">
                {responseStats.responseRate}% response rate
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Output Tokens
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(responseStats.totalResponseTokens)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Characters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(responseStats.totalResponseChars)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg Response
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(responseStats.avgResponseLength)}
              </div>
              <p className="text-xs text-muted-foreground">characters</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Daily Activity Chart */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle>
              Token Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TokenUsageChart
              data={dailyStats.map(d => ({
                date: d.date,
                tokens: Number(d.tokens ?? 0),
                inputTokens: Number(d.inputTokens ?? 0),
                outputTokens: Number(d.outputTokens ?? 0),
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* Projects / Sessions */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Project Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {projectActivity.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
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

        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.summary.sessions === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                Not enough activity to analyze sessions.
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Sessions (30d)</div>
                    <div className="text-foreground font-medium">
                      {sessions.summary.sessions}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Avg prompts</div>
                    <div className="text-foreground font-medium">
                      {sessions.summary.avgPromptsPerSession}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Avg minutes</div>
                    <div className="text-foreground font-medium">
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

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Projects */}
        <Card>
          <CardHeader>
            <CardTitle>Top Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {projectStats.map((project, i) => (
                <div key={project.project || i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm w-4">{i + 1}.</span>
                    <span className="text-foreground font-medium">
                      {project.project}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-sm">
                      {formatNumber(Number(project.tokens))} tokens
                    </span>
                    <Badge variant="secondary">{project.count}</Badge>
                  </div>
                </div>
              ))}
              {projectStats.length === 0 && (
                <p className="text-muted-foreground text-center py-4">No project data</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Prompt Types */}
        <Card>
          <CardHeader>
            <CardTitle>Prompt Types</CardTitle>
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
                      <span className="text-secondary-foreground">{label}</span>
                      <span className="text-muted-foreground">
                        {type.count} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
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
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentPrompts.map((prompt) => (
              <div
                key={prompt.id}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full ${prompt.hasResponse ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                  <div>
                    <p className="text-foreground text-sm">
                      {prompt.projectName ?? "No project"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatDate(prompt.timestamp)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {prompt.hasResponse && (
                    <Badge variant="outline" className="text-green-500 border-green-800 text-[10px]">
                      responded
                    </Badge>
                  )}
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
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
