"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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

interface CalendarDay {
  date: string;
  count: number;
}

interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface TimelineData {
  days: TimelineDay[];
  pagination?: PaginationInfo;
}

const PAGE_SIZE = 500;

export default function TimelinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<TimelineData | null>(null);
  const [calendarData, setCalendarData] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const calendarAbortRef = useRef<AbortController | null>(null);

  const selectedDate = searchParams.get("date") || null;
  const projectFilter = searchParams.get("project") || null;
  const sourceFilter = searchParams.get("source") || null;

  // Default: last 365 days for calendar, configurable via from/to
  const fromParam = searchParams.get("from") || null;
  const toParam = searchParams.get("to") || null;

  const fetchData = useCallback(async (offset = 0, append = false) => {
    // Abort any in-flight request to prevent stale data
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (!append) {
      setLoading(true);
      setError(null);
    }

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
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));

    try {
      const res = await fetch(`/api/sessions/timeline?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load timeline data");
      }
      const json: TimelineData = await res.json();

      if (append && data) {
        // Merge new days into existing data
        const existingDayMap = new Map(data.days.map((d) => [d.date, d]));
        for (const day of json.days) {
          const existing = existingDayMap.get(day.date);
          if (existing) {
            existing.sessions.push(...day.sessions);
          } else {
            existingDayMap.set(day.date, day);
          }
        }
        const mergedDays = Array.from(existingDayMap.values()).sort((a, b) =>
          a.date.localeCompare(b.date)
        );
        setData({ days: mergedDays, pagination: json.pagination });
      } else {
        setData(json);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return; // Silently ignore aborted requests
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [fromParam, toParam, projectFilter, sourceFilter, data]);

  /** Fetch full-range calendar summary (not paginated). */
  const fetchCalendar = useCallback(async () => {
    if (calendarAbortRef.current) {
      calendarAbortRef.current.abort();
    }
    const controller = new AbortController();
    calendarAbortRef.current = controller;

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
      const res = await fetch(`/api/sessions/timeline/calendar?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const json = await res.json();
      if (!controller.signal.aborted) {
        setCalendarData(json.days ?? []);
      }
    } catch {
      // Silently ignore calendar fetch errors (timeline still works)
    }
  }, [fromParam, toParam, projectFilter, sourceFilter]);

  useEffect(() => {
    fetchData();
    fetchCalendar();
    return () => {
      // Cleanup: abort on unmount or dependency change
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (calendarAbortRef.current) {
        calendarAbortRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromParam, toParam, projectFilter, sourceFilter]);

  const loadMore = useCallback(() => {
    if (data?.pagination?.hasMore) {
      fetchData(data.pagination.offset + data.pagination.limit, true);
    }
  }, [data, fetchData]);

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

  // Build full-range calendar data from the dedicated calendar endpoint
  const calendarDisplayData = buildCalendarDisplayData(calendarData, fromParam, toParam);

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

  const totalSessions = calendarData.reduce((sum, d) => sum + d.count, 0);

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
                  data={calendarDisplayData}
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
              {/* Load more button for pagination */}
              {data?.pagination?.hasMore && (
                <div className="flex justify-center mt-4">
                  <button
                    type="button"
                    onClick={loadMore}
                    className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-secondary/50 transition-colors"
                  >
                    Load more sessions ({Math.max(0, data.pagination.total - data.pagination.offset - data.pagination.limit)} remaining)
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * Build calendar display data from the dedicated calendar endpoint response,
 * filling in zeros for days without sessions across the full date range.
 */
function buildCalendarDisplayData(
  days: CalendarDay[],
  fromParam: string | null,
  toParam: string | null
): Array<{ date: string; sessionCount: number }> {
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const from = fromParam ? new Date(fromParam) : yearAgo;
  const to = toParam ? new Date(toParam) : now;

  // Build a map of date -> session count from the calendar endpoint
  const countMap = new Map<string, number>();
  for (const day of days) {
    countMap.set(day.date, day.count);
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
