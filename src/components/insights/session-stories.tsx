"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionStoryButton } from "./session-story-button";
import Link from "next/link";

interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  responseCount: number;
  projectName: string | null;
  source: string | null;
  deviceName: string | null;
  firstPrompt: string;
  totalTokens: number;
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
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

function SessionRow({ session }: { session: SessionSummary }) {
  const [showStory, setShowStory] = useState(false);

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/sessions/${session.sessionId}`}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
            >
              {session.projectName || session.sessionId.slice(0, 12) + "..."}
            </Link>
            {session.source && (
              <Badge variant="outline" className="text-xs">{session.source}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {session.firstPrompt}
          </p>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>{new Date(session.startedAt).toLocaleDateString()}</span>
            <span>{formatDuration(session.startedAt, session.endedAt)}</span>
            <span>{session.promptCount} prompts</span>
            <span>{formatTokens(session.totalTokens)} tokens</span>
          </div>
        </div>
        <button
          onClick={() => setShowStory(!showStory)}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {showStory ? "Hide" : "Generate Story"}
        </button>
      </div>

      {showStory && (
        <div className="border-t border-border pt-3">
          <SessionStoryButton sessionId={session.sessionId} />
        </div>
      )}
    </div>
  );
}

export function SessionStories() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch("/api/sessions?page=1");
        if (!res.ok) {
          throw new Error("Failed to fetch sessions");
        }
        const data = await res.json();
        // Take only the 10 most recent sessions
        setSessions((data.sessions || []).slice(0, 10));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sessions");
      } finally {
        setLoading(false);
      }
    }
    fetchSessions();
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Session Stories</CardTitle>
            <CardDescription>
              Generate AI narratives for your recent coding sessions
            </CardDescription>
          </div>
          <Link
            href="/sessions"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View all sessions
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-32 animate-pulse rounded bg-skeleton" />
                    <div className="h-3 w-full animate-pulse rounded bg-skeleton" />
                    <div className="h-3 w-48 animate-pulse rounded bg-skeleton" />
                  </div>
                  <div className="h-8 w-28 animate-pulse rounded bg-skeleton" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No sessions found. Sessions are created when prompts share a session ID.
          </p>
        )}

        {!loading && !error && sessions.length > 0 && (
          <div className="space-y-3">
            {sessions.map((session) => (
              <SessionRow key={session.sessionId} session={session} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
