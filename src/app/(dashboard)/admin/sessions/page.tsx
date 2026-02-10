"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/contexts/user-context";
import { SessionCard } from "@/components/session-card";
import { Button } from "@/components/ui/button";

interface SessionItem {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  responseCount: number;
  projectName?: string | null;
  source?: string | null;
  deviceName?: string | null;
  userId?: string | null;
  firstPrompt: string;
  totalTokens?: number;
}

function AdminSessionsContent() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = 20;
  const totalPages = Math.ceil(totalCount / pageSize);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (page > 1) params.set("page", String(page));

      const res = await fetch(`/api/admin/sessions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
        setTotalCount(data.totalCount);
      }
    } catch (error) {
      console.error("Failed to fetch admin sessions:", error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!userLoading && user?.isAdmin) {
      fetchSessions();
    }
  }, [userLoading, user, fetchSessions]);

  if (userLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-zinc-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p>Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">All Sessions</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Browse sessions across all users ({totalCount} total)
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-zinc-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p>No sessions found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.sessionId}
              sessionId={s.sessionId}
              firstPrompt={s.firstPrompt}
              startedAt={s.startedAt}
              endedAt={s.endedAt}
              promptCount={s.promptCount}
              responseCount={s.responseCount}
              projectName={s.projectName}
              source={s.source}
              deviceName={s.deviceName}
              totalTokens={s.totalTokens}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => router.push(`/admin/sessions?page=${page - 1}`)}
          >
            Previous
          </Button>
          <span className="text-sm text-zinc-400">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => router.push(`/admin/sessions?page=${page + 1}`)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AdminSessionsPage() {
  return (
    <Suspense fallback={
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-zinc-800 rounded-lg animate-pulse" />
        ))}
      </div>
    }>
      <AdminSessionsContent />
    </Suspense>
  );
}
