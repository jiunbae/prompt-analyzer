import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MiniActivityChart } from "@/components/charts/mini-activity-chart";
import { getSessionUser } from "@/lib/with-auth";
import { getDashboardData } from "@/lib/dashboard";
import { formatNumber } from "@/lib/analytics";
import { InsightCards } from "@/components/insights/insight-cards";

export const dynamic = "force-dynamic";

const getCurrentUser = getSessionUser;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (current === 0 && previous === 0) return null;
  const delta = current - previous;
  if (delta === 0) return <span className="text-xs text-muted-foreground">same</span>;
  const isPositive = delta > 0;
  return (
    <span className={`text-xs font-medium ${isPositive ? "text-green-500" : "text-red-400"}`}>
      {isPositive ? "+" : ""}{formatNumber(delta)}
    </span>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const data = await getDashboardData(user.userId);

  if (!data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Unable to load dashboard data.</p>
      </div>
    );
  }

  const userName = user.email.split("@")[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {getGreeting()}, {userName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here&apos;s your prompt activity overview
          </p>
        </div>
        <Link
          href="/analytics"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          View Insights
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Today's Snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Prompts Today", value: data.today.prompts, prev: data.yesterday.prompts },
          { label: "Tokens Today", value: data.today.tokens, prev: data.yesterday.tokens, fmt: true },
          { label: "Sessions Today", value: data.today.sessions, prev: data.yesterday.sessions },
          { label: "Active Projects", value: data.today.projects, prev: data.yesterday.projects },
        ].map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-foreground">
                  {item.fmt ? formatNumber(item.value) : item.value}
                </div>
                <DeltaBadge current={item.value} previous={item.prev} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">vs. yesterday</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* This Week + Top Projects */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniActivityChart data={data.last7Days} />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
              {data.last7Days.map((d) => (
                <span key={d.date}>
                  {new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short" })}
                </span>
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
              <span>Total: {data.last7Days.reduce((s, d) => s + d.count, 0)} prompts</span>
              <span>Avg: {Math.round(data.last7Days.reduce((s, d) => s + d.count, 0) / 7)}/day</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Top Projects</CardTitle>
              <span className="text-xs text-muted-foreground">Last 7 days</span>
            </div>
          </CardHeader>
          <CardContent>
            {data.topProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No project activity this week</p>
            ) : (
              <div className="space-y-3">
                {data.topProjects.map((p) => {
                  const maxCount = data.topProjects[0]?.count ?? 1;
                  const pct = (p.count / maxCount) * 100;
                  return (
                    <div key={p.project} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground font-medium truncate">{p.project}</span>
                        <span className="text-muted-foreground shrink-0 ml-2">{p.count}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Sessions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Sessions</CardTitle>
            <Link href="/sessions" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {data.recentSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No sessions yet. Start prompting!</p>
          ) : (
            <div className="divide-y divide-border">
              {data.recentSessions.map((s) => (
                <Link key={s.sessionId} href={`/sessions/${s.sessionId}`} className="block">
                  <div className="flex items-center justify-between py-3 hover:bg-accent/50 -mx-2 px-2 rounded transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground line-clamp-1 whitespace-pre-line">{s.firstPrompt || "Empty session"}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {s.projectName && <Badge variant="secondary" className="text-[10px]">{s.projectName}</Badge>}
                        {s.source && <Badge variant="outline" className="text-[10px]">{s.source}</Badge>}
                        <span className="text-xs text-muted-foreground">{formatTimeAgo(s.endedAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground ml-4 shrink-0">
                      <span>{s.promptCount} prompts</span>
                      {s.totalTokens > 0 && <span>{formatNumber(s.totalTokens)} tokens</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Insights */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-purple-400" />
          AI Insights
        </h2>
        <InsightCards />
      </div>
    </div>
  );
}
