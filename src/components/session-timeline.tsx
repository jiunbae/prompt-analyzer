"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

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

interface SessionTimelineProps {
  days: TimelineDay[];
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  session: TimelineSession | null;
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getSourceColor(source: string | null): string {
  switch (source?.toLowerCase()) {
    case "claude":
    case "claude-code":
      return "bg-blue-500 dark:bg-blue-400";
    case "codex":
      return "bg-green-500 dark:bg-green-400";
    case "cursor":
      return "bg-purple-500 dark:bg-purple-400";
    default:
      return "bg-zinc-400 dark:bg-zinc-500";
  }
}

function getSourceBorderColor(source: string | null): string {
  switch (source?.toLowerCase()) {
    case "claude":
    case "claude-code":
      return "hover:ring-blue-400";
    case "codex":
      return "hover:ring-green-400";
    case "cursor":
      return "hover:ring-purple-400";
    default:
      return "hover:ring-zinc-400";
  }
}

/**
 * Compute bar position using UTC hours consistently.
 * Handles sessions that cross midnight by clamping to the 0-24 range
 * and computing duration as absolute elapsed time.
 */
function computeBarPosition(session: TimelineSession): { leftPct: number; widthPct: number } {
  const startTime = new Date(session.startedAt);
  const endTime = new Date(session.endedAt);

  // Use UTC hours for consistency with UTC-based day grouping
  const startHour = startTime.getUTCHours() + startTime.getUTCMinutes() / 60;

  // Compute duration in hours from absolute timestamps (avoids negative width for midnight-crossing)
  const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

  // If the session is unreasonably long (>24h), cap it at end of day
  const effectiveDuration = Math.min(durationHours, 24 - startHour);

  const leftPct = (startHour / 24) * 100;
  // Ensure a minimum visible width
  const widthPct = Math.max((effectiveDuration / 24) * 100, 0.5);

  return { leftPct, widthPct };
}

const HOUR_LABELS = ["0", "3", "6", "9", "12", "15", "18", "21", "24"];
const TIMELINE_WIDTH = 720; // px for the 24h axis

export function SessionTimeline({ days }: SessionTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    session: null,
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, session: TimelineSession) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const barRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setTooltip({
        visible: true,
        x: barRect.left - rect.left + barRect.width / 2,
        y: barRect.top - rect.top - 4,
        session,
      });
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  if (days.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No sessions in this date range.</p>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Tooltip */}
      {tooltip.visible && tooltip.session && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: Math.min(Math.max(tooltip.x, 120), TIMELINE_WIDTH + 80),
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="bg-foreground text-background rounded-md px-3 py-2 text-xs shadow-lg whitespace-nowrap max-w-xs">
            <p className="font-medium truncate">{tooltip.session.firstPrompt || "No prompt"}</p>
            <div className="flex gap-3 mt-1 text-background/70">
              {tooltip.session.projectName && <span>{tooltip.session.projectName}</span>}
              <span>{tooltip.session.promptCount} prompt{tooltip.session.promptCount !== 1 ? "s" : ""}</span>
              <span>{formatTokens(tooltip.session.totalTokens)} tokens</span>
              <span>{formatDuration(tooltip.session.duration)}</span>
            </div>
          </div>
          <div className="w-2 h-2 bg-foreground rotate-45 mx-auto -mt-1" />
        </div>
      )}

      {/* Hour axis header */}
      <div className="flex items-end mb-2">
        <div className="w-[100px] shrink-0" />
        <div className="relative" style={{ width: TIMELINE_WIDTH }}>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            {HOUR_LABELS.map((label) => (
              <span key={label}>{label}h</span>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline rows */}
      <div className="space-y-1">
        {days.map((day) => (
          <div key={day.date} className="flex items-center group">
            {/* Date label */}
            <div className="w-[100px] shrink-0 text-xs text-muted-foreground pr-3 text-right">
              {formatDateLabel(day.date)}
            </div>

            {/* Timeline bar area */}
            <div
              className="relative bg-secondary/20 dark:bg-secondary/10 rounded-sm"
              style={{ width: TIMELINE_WIDTH, height: 24 }}
            >
              {/* Hour grid lines */}
              {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
                <div
                  key={hour}
                  className="absolute top-0 bottom-0 w-px bg-border/30"
                  style={{ left: `${(hour / 24) * 100}%` }}
                />
              ))}

              {/* Session bars */}
              {day.sessions.map((session) => {
                const { leftPct, widthPct } = computeBarPosition(session);

                return (
                  <div
                    key={session.sessionId}
                    className={`absolute top-1 bottom-1 rounded-sm cursor-pointer transition-all
                      ${getSourceColor(session.source)} ${getSourceBorderColor(session.source)}
                      hover:ring-2 hover:brightness-110 opacity-80 hover:opacity-100`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: "4px",
                    }}
                    onMouseEnter={(e) => handleMouseEnter(e, session)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => router.push(`/sessions/${session.sessionId}`)}
                  />
                );
              })}
            </div>

            {/* Session count */}
            <div className="w-[60px] shrink-0 text-xs text-muted-foreground pl-3 opacity-0 group-hover:opacity-100 transition-opacity">
              {day.sessions.length} sess.
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-blue-500 dark:bg-blue-400" />
          <span>Claude</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-500 dark:bg-green-400" />
          <span>Codex</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-purple-500 dark:bg-purple-400" />
          <span>Cursor</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-zinc-400 dark:bg-zinc-500" />
          <span>Other</span>
        </div>
      </div>
    </div>
  );
}
