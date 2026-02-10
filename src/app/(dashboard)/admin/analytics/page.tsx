"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/contexts/user-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { TokenUsageChart } from "@/components/charts/token-usage-chart";
import { ProjectActivityChart } from "@/components/charts/project-activity-chart";
import { SessionChart } from "@/components/charts/session-chart";

interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

interface UserSummaryRow {
  id: string;
  name: string | null;
  email: string;
  totalPrompts: number;
  totalTokens: number;
  uniqueProjects: number;
  lastActivity: string | null;
  prompts30d: number;
}

interface AnalyticsData {
  stats: {
    totalPrompts: number;
    totalTokens: number;
    totalChars: number;
    uniqueProjects: number;
    avgPromptLength: number;
  };
  responseStats: {
    totalResponses: number;
    totalResponseTokens: number;
    totalResponseChars: number;
    avgResponseLength: number;
    responseRate: number;
  };
  dailyStats: Array<{ date: string; count: number; tokens: number; inputTokens: number; outputTokens: number }>;
  projectStats: Array<{ project: string | null; count: number; tokens: number }>;
  typeStats: Array<{ type: string | null; count: number }>;
  recentPrompts: Array<{
    id: string;
    timestamp: string;
    projectName: string | null;
    promptLength: number;
    promptType: string | null;
    hasResponse: boolean;
  }>;
  projectActivity: Array<{ project: string; count: number }>;
  sessions: {
    summary: {
      sessions: number;
      avgPromptsPerSession: number;
      avgSessionMinutes: number;
    };
    perDay: Array<{ date: string; sessions: number }>;
  };
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AdminAnalyticsPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [userSummary, setUserSummary] = useState<UserSummaryRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAnalytics = useCallback(
    async (userId?: string) => {
      try {
        setLoading(true);
        setError("");
        const params = userId && userId !== "all" ? `?userId=${userId}` : "";
        const res = await fetch(`/api/admin/analytics${params}`);

        if (res.ok) {
          const data = await res.json();
          setAnalytics(data.analytics);
          setUsers(data.users);
          setUserSummary(data.userSummary);
        } else if (res.status === 403) {
          router.push("/prompts");
        } else {
          const data = await res.json();
          setError(data.error || "Failed to fetch analytics");
        }
      } catch {
        setError("Failed to fetch analytics");
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    if (!userLoading && !user?.isAdmin) {
      router.push("/prompts");
      return;
    }
    if (!userLoading && user?.isAdmin) {
      fetchAnalytics();
    }
  }, [userLoading, user, router, fetchAnalytics]);

  const handleUserChange = (userId: string) => {
    setSelectedUserId(userId);
    fetchAnalytics(userId);
  };

  if (userLoading || loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Unable to load analytics.</p>
      </div>
    );
  }

  const { stats, responseStats, dailyStats, projectStats, typeStats, recentPrompts, projectActivity, sessions } =
    analytics;

  return (
    <div className="space-y-6">
      {/* Header + Filter */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Admin Insights</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedUserId === "all"
              ? "Analytics across all users"
              : `Filtered by ${users.find((u) => u.id === selectedUserId)?.name || users.find((u) => u.id === selectedUserId)?.email || "user"}`}
          </p>
        </div>
        <select
          value={selectedUserId}
          onChange={(e) => handleUserChange(e.target.value)}
          className="rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.email}
            </option>
          ))}
        </select>
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
      {responseStats && (
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
      )}

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="">
          <CardHeader>
            <CardTitle>Activity Heatmap</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityHeatmap
              data={dailyStats.map((d) => ({
                date: d.date,
                count: Number(d.count ?? 0),
              }))}
            />
          </CardContent>
        </Card>

        <Card className="">
          <CardHeader>
            <CardTitle>Token Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <TokenUsageChart
              data={dailyStats.map((d) => ({
                date: d.date,
                tokens: Number(d.tokens ?? 0),
                inputTokens: Number(d.inputTokens ?? 0),
                outputTokens: Number(d.outputTokens ?? 0),
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="">
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

        <Card className="">
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

      {/* User Leaderboard */}
      {selectedUserId === "all" && userSummary.length > 0 && (
        <Card className="">
          <CardHeader>
            <CardTitle>User Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total Prompts
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Est. Tokens
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Projects
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      30d Prompts
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Last Active
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {userSummary.map((row) => (
                    <tr
                      key={row.id}
                      className="hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => handleUserChange(row.id)}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-medium text-white shrink-0">
                            {row.name?.[0]?.toUpperCase() || row.email[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-foreground font-medium truncate">
                              {row.name || row.email.split("@")[0]}
                            </p>
                            <p className="text-muted-foreground text-xs truncate">{row.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-secondary-foreground">
                        {formatNumber(row.totalPrompts)}
                      </td>
                      <td className="px-3 py-3 text-right text-secondary-foreground">
                        {formatNumber(row.totalTokens)}
                      </td>
                      <td className="px-3 py-3 text-right text-secondary-foreground">
                        {row.uniqueProjects}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Badge variant="secondary">{row.prompts30d}</Badge>
                      </td>
                      <td className="px-3 py-3 text-right text-muted-foreground text-xs">
                        {formatRelativeDate(row.lastActivity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Projects + Prompt Types */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="">
          <CardHeader>
            <CardTitle>Top Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {projectStats.map((project, i) => (
                <div key={project.project || i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm w-4">{i + 1}.</span>
                    <span className="text-foreground font-medium">{project.project}</span>
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

        <Card className="">
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
      <Card className="">
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
            {recentPrompts.length === 0 && (
              <p className="text-muted-foreground text-center py-4">No recent activity</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
