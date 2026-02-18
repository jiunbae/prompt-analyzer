"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionCalendar } from "@/components/session-calendar";
import { SessionTimeline } from "@/components/session-timeline";

interface TimelineSession {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  totalTokens: number;
  projectName: string | null;
  source: string | null;
  firstPrompt: string;
  duration: number;
}

interface TimelineDay {
  date: string;
  sessions: TimelineSession[];
}

interface TimelineData {
  days: TimelineDay[];
}

export default function TimelinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedDate = searchParams.get("date") || null;
  const projectFilter = searchParams.get("project") || null;
  const sourceFilter = searchParams.get("source") || null;

  // Default: last 365 days for calendar, configurable via from/to
  const fromParam = searchParams.get("from") || null;
  const toParam = searchParams.get("to") || null;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (fromParam) {
      params.set("from", fromParam);
    } else {
      const yearAgo = new Date();
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      params.set("from", yearAgo.toISOString().slice(0, 10));
    }
    if (toParam) {
      params.set("to", toParam);
    } else {
      params.set("to", new Date().toISOString().slice(0, 10));
    }
    if (projectFilter) params.set("project", projectFilter);
    if (sourceFilter) params.set("source", sourceFilter);

    try {
      const res = await fetch(`/api/sessions/timeline?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to load timeline data");
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [fromParam, toParam, projectFilter, sourceFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      // Remove page param on filter change
      params.delete("page");
      router.push(`/timeline?${params.toString()}`);
    },
    [router, searchParams]
  );

  // Build calendar data from timeline days
  const calendarData = data
    ? buildCalendarData(data.days, fromParam, toParam)
    : [];

  // Filter timeline days if a date is selected
  const timelineDays = data
    ? selectedDate
      ? data.days.filter((d) => d.date === selectedDate)
      : data.days
    : [];

  // Collect unique projects and sources for filters
  const allProjects = new Set<string>();
  const allSources = new Set<string>();
  if (data) {
    for (const day of data.days) {
      for (const session of day.sessions) {
        if (session.projectName) allProjects.add(session.projectName);
        if (session.source) allSources.add(session.source);
      }
    }
  }

  const totalSessions = data
    ? data.days.reduce((sum, d) => sum + d.sessions.length, 0)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Timeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visual overview of your coding sessions over time
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="from-date" className="text-xs text-muted-foreground font-medium">
            From
          </label>
          <input
            id="from-date"
            type="date"
            value={fromParam ?? ""}
            onChange={(e) => updateParams({ from: e.target.value || null })}
            className="px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="to-date" className="text-xs text-muted-foreground font-medium">
            To
          </label>
          <input
            id="to-date"
            type="date"
            value={toParam ?? ""}
            onChange={(e) => updateParams({ to: e.target.value || null })}
            className="px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
          />
        </div>

        {allProjects.size > 0 && (
          <div className="space-y-1">
            <label htmlFor="project-filter" className="text-xs text-muted-foreground font-medium">
              Project
            </label>
            <select
              id="project-filter"
              value={projectFilter ?? ""}
              onChange={(e) => updateParams({ project: e.target.value || null })}
              className="px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            >
              <option value="">All projects</option>
              {[...allProjects].sort().map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}

        {allSources.size > 0 && (
          <div className="space-y-1">
            <label htmlFor="source-filter" className="text-xs text-muted-foreground font-medium">
              Source
            </label>
            <select
              id="source-filter"
              value={sourceFilter ?? ""}
              onChange={(e) => updateParams({ source: e.target.value || null })}
              className="px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            >
              <option value="">All sources</option>
              {[...allSources].sort().map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {(projectFilter || sourceFilter || fromParam || toParam || selectedDate) && (
          <button
            type="button"
            onClick={() =>
              updateParams({
                project: null,
                source: null,
                from: null,
                to: null,
                date: null,
              })
            }
            className="text-xs text-muted-foreground hover:text-foreground underline pb-2"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          <p className="font-medium">Failed to load timeline</p>
          <p className="mt-1 text-red-400/80">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Session Calendar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[140px] bg-skeleton animate-pulse rounded" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Session Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-6 bg-skeleton animate-pulse rounded" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {/* Calendar Heatmap */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Session Calendar</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {totalSessions} session{totalSessions !== 1 ? "s" : ""} total
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <SessionCalendar
                  data={calendarData}
                  selectedDate={selectedDate}
                  onSelectDate={(date) => updateParams({ date })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Session Timeline */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  {selectedDate
                    ? `Sessions on ${new Date(selectedDate + "T12:00:00Z").toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}`
                    : "Session Timeline"}
                </CardTitle>
                {selectedDate && (
                  <button
                    type="button"
                    onClick={() => updateParams({ date: null })}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Show all days
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <SessionTimeline days={timelineDays} />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * Build calendar data from timeline days, filling in zeros for days without sessions.
 */
function buildCalendarData(
  days: TimelineDay[],
  fromParam: string | null,
  toParam: string | null
): Array<{ date: string; sessionCount: number }> {
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const from = fromParam ? new Date(fromParam) : yearAgo;
  const to = toParam ? new Date(toParam) : now;

  // Build a map of date -> session count
  const countMap = new Map<string, number>();
  for (const day of days) {
    countMap.set(day.date, day.sessions.length);
  }

  // Fill all days in range
  const result: Array<{ date: string; sessionCount: number }> = [];
  const cursor = new Date(from);
  cursor.setUTCHours(12, 0, 0, 0);
  const endDate = new Date(to);
  endDate.setUTCHours(12, 0, 0, 0);

  while (cursor <= endDate) {
    const dateStr = cursor.toISOString().slice(0, 10);
    result.push({
      date: dateStr,
      sessionCount: countMap.get(dateStr) ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}
