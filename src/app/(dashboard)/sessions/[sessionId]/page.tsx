import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { checkIsAdmin, getSessionUser } from "@/lib/with-auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SessionThread } from "@/components/session-thread";
import { SessionStoryButton } from "@/components/insights/session-story-button";

export const dynamic = "force-dynamic";

const getCurrentUser = getSessionUser;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

interface SessionDetailPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionDetailPage({ params }: SessionDetailPageProps) {
  const { sessionId } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  const isAdmin = await checkIsAdmin(user.userId);

  const sessionConditions = isAdmin
    ? eq(schema.prompts.sessionId, sessionId)
    : and(eq(schema.prompts.userId, user.userId), eq(schema.prompts.sessionId, sessionId));

  const prompts = await db.query.prompts.findMany({
    where: sessionConditions,
    orderBy: [desc(schema.prompts.timestamp)],
    with: {
      promptTags: {
        with: {
          tag: true,
        },
      },
    },
  });

  if (prompts.length === 0) {
    notFound();
  }

  const first = prompts[0];
  const last = prompts[prompts.length - 1];
  const totalInputTokens = prompts.reduce((sum, p) => sum + (p.tokenEstimate ?? Math.ceil(p.promptLength / 4)), 0);
  const totalOutputTokens = prompts.reduce((sum, p) => sum + (p.tokenEstimateResponse ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Sessions
        </Link>
      </div>

      {/* Session metadata header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatDate(first.timestamp)} — {formatDuration(first.timestamp, last.timestamp)}
            </div>
            {first.projectName && (
              <Badge variant="secondary">{first.projectName}</Badge>
            )}
            {first.source && (
              <Badge variant="outline">{first.source}</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-4 mt-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Prompts:</span>
              <span className="text-secondary-foreground">{prompts.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Responses:</span>
              <span className="text-secondary-foreground">{prompts.filter(p => p.responseText).length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Input:</span>
              <span className="text-secondary-foreground">{formatTokens(totalInputTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Output:</span>
              <span className="text-secondary-foreground">{formatTokens(totalOutputTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-medium text-foreground">{formatTokens(totalInputTokens + totalOutputTokens)} tokens</span>
            </div>
          </div>
          {first.workingDirectory && (
            <div className="mt-2 text-xs text-muted-foreground font-mono truncate" title={first.workingDirectory}>
              {first.workingDirectory}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Session Story */}
      <SessionStoryButton sessionId={sessionId} />

      {/* Conversation thread */}
      <SessionThread
        prompts={prompts.map((p) => ({
          id: p.id,
          timestamp: p.timestamp.toISOString(),
          promptText: p.promptText,
          responseText: p.responseText,
          tokenEstimate: p.tokenEstimate,
          tokenEstimateResponse: p.tokenEstimateResponse,
          promptTags: p.promptTags.map((pt) => ({
            tag: { id: pt.tag.id, name: pt.tag.name, color: pt.tag.color },
          })),
        }))}
        responseCount={prompts.filter((p) => p.responseText).length}
      />
    </div>
  );
}
