"use client";

import { useState, useRef, useCallback } from "react";

interface DayData {
  date: string;
  sessionCount: number;
}

interface SessionCalendarProps {
  data: DayData[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  date: string;
  count: number;
}

function formatTooltipDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Compute quantile-based color thresholds for the heatmap.
 * Uses percentiles of non-zero values so outliers don't flatten the scale.
 */
function computeQuantileThresholds(data: DayData[]): [number, number, number, number] {
  const nonZero = data.map((d) => d.sessionCount).filter((c) => c > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [1, 2, 3, 4];

  const p = (pct: number) => {
    const idx = Math.min(Math.floor(pct * nonZero.length), nonZero.length - 1);
    return nonZero[idx];
  };

  const q25 = p(0.25);
  const q50 = p(0.5);
  const q75 = p(0.75);
  const q100 = nonZero[nonZero.length - 1];

  // Ensure strictly increasing thresholds (fall back to max-relative when data is too uniform)
  if (q25 === q100) return [q25, q25 + 1, q25 + 2, q25 + 3];
  return [q25, q50, q75, q100];
}

export function SessionCalendar({ data, selectedDate, onSelectDate }: SessionCalendarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    date: "",
    count: 0,
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, day: { date: string; count: number; inRange: boolean }) => {
      if (!day.inRange || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const tileRect = (e.target as HTMLElement).getBoundingClientRect();
      setTooltip({
        visible: true,
        x: tileRect.left - rect.left + tileRect.width / 2,
        y: tileRect.top - rect.top - 4,
        date: day.date,
        count: day.count,
      });
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No session data</p>;
  }

  const countMap = new Map(data.map((d) => [d.date, d.sessionCount]));
  const totalSessions = data.reduce((sum, d) => sum + d.sessionCount, 0);
  const activeDays = data.filter((d) => d.sessionCount > 0).length;

  // Quantile-based thresholds for better color distribution
  const [q25, q50, q75] = computeQuantileThresholds(data);

  // Build full calendar grid for the year
  const sortedDates = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const startDate = new Date(sortedDates[0].date + "T12:00:00Z");
  const endDate = new Date(sortedDates[sortedDates.length - 1].date + "T12:00:00Z");

  // Align grid to week boundaries (Sunday start)
  const gridStart = new Date(startDate);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());

  const gridEnd = new Date(endDate);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const days: Array<{ date: string; count: number; inRange: boolean }> = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const dateStr = cursor.toISOString().slice(0, 10);
    days.push({
      date: dateStr,
      count: countMap.get(dateStr) ?? 0,
      inRange: cursor >= startDate && cursor <= endDate,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Month labels
  const monthLabels: Array<{ label: string; colIndex: number }> = [];
  let lastMonth = "";
  weeks.forEach((week, colIdx) => {
    const refDay = week.find((d) => d.inRange) ?? week[0];
    const month = new Date(refDay.date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short" });
    if (month !== lastMonth) {
      monthLabels.push({ label: month, colIndex: colIdx });
      lastMonth = month;
    }
  });

  const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

  const getColor = (count: number, inRange: boolean) => {
    if (!inRange) return "bg-transparent";
    if (count === 0) return "bg-secondary/50 dark:bg-secondary/30";
    if (count <= q25) return "bg-blue-200 dark:bg-blue-900/60";
    if (count <= q50) return "bg-blue-400 dark:bg-blue-700/80";
    if (count <= q75) return "bg-blue-500 dark:bg-blue-500";
    return "bg-blue-600 dark:bg-blue-400";
  };

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="bg-foreground text-background rounded-md px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap">
            <p className="font-medium">
              {tooltip.count === 0
                ? "No sessions"
                : `${tooltip.count} session${tooltip.count !== 1 ? "s" : ""}`}
            </p>
            <p className="text-background/70 text-[10px]">{formatTooltipDate(tooltip.date)}</p>
          </div>
          <div className="w-2 h-2 bg-foreground rotate-45 mx-auto -mt-1" />
        </div>
      )}

      {/* Month labels row */}
      <div className="flex">
        <div className="w-8 shrink-0" />
        <div className="flex gap-[3px] relative">
          {weeks.map((_, colIdx) => {
            const ml = monthLabels.find((m) => m.colIndex === colIdx);
            return (
              <div key={colIdx} className="w-[13px] text-[10px] text-muted-foreground">
                {ml ? ml.label : ""}
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid: 7 rows x N columns */}
      <div className="flex">
        {/* Day-of-week labels */}
        <div className="flex flex-col gap-[3px] w-8 shrink-0">
          {dayLabels.map((label, i) => (
            <div key={i} className="h-[13px] text-[10px] text-muted-foreground leading-[13px]">
              {label}
            </div>
          ))}
        </div>

        {/* Tile grid */}
        <div className="flex gap-[3px]">
          {weeks.map((week, colIdx) => (
            <div key={colIdx} className="flex flex-col gap-[3px]">
              {week.map((day) => (
                <div
                  key={day.date}
                  className={`w-[13px] h-[13px] rounded-sm transition-colors ${getColor(day.count, day.inRange)} ${
                    day.inRange ? "hover:ring-1 hover:ring-foreground/40 cursor-pointer" : ""
                  } ${selectedDate === day.date ? "ring-2 ring-foreground" : ""}`}
                  onMouseEnter={(e) => handleMouseEnter(e, day)}
                  onMouseLeave={handleMouseLeave}
                  onClick={() => {
                    if (!day.inRange) return;
                    onSelectDate(selectedDate === day.date ? null : day.date);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
        <span>
          {totalSessions.toLocaleString()} session{totalSessions !== 1 ? "s" : ""} in {activeDays} active day{activeDays !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1">
          <span>Less</span>
          <div className="w-[10px] h-[10px] rounded-sm bg-secondary/50 dark:bg-secondary/30" />
          <div className="w-[10px] h-[10px] rounded-sm bg-blue-200 dark:bg-blue-900/60" />
          <div className="w-[10px] h-[10px] rounded-sm bg-blue-400 dark:bg-blue-700/80" />
          <div className="w-[10px] h-[10px] rounded-sm bg-blue-500 dark:bg-blue-500" />
          <div className="w-[10px] h-[10px] rounded-sm bg-blue-600 dark:bg-blue-400" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
