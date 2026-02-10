"use client";

interface ActivityData {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  data: ActivityData[];
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No activity data</p>;
  }

  const countMap = new Map(data.map((d) => [d.date, d.count]));
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  // Build full calendar grid: fill from the earliest date to the latest, then
  // pad so columns start on Sunday and end on Saturday (GitHub style).
  const sortedDates = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const startDate = new Date(sortedDates[0].date + "T12:00:00Z");
  const endDate = new Date(sortedDates[sortedDates.length - 1].date + "T12:00:00Z");

  // Pad start to Sunday of that week
  const gridStart = new Date(startDate);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());

  // Pad end to Saturday of that week
  const gridEnd = new Date(endDate);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  // Build all days in grid
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

  // Group into weeks (columns)
  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Month labels: find the first occurrence of each month across weeks
  const monthLabels: Array<{ label: string; colIndex: number }> = [];
  let lastMonth = "";
  weeks.forEach((week, colIdx) => {
    // Use the first day of the week that's in range, or the first day
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
    if (count < maxCount * 0.25) return "bg-green-200 dark:bg-green-900/60";
    if (count < maxCount * 0.5) return "bg-green-400 dark:bg-green-700/80";
    if (count < maxCount * 0.75) return "bg-green-500 dark:bg-green-500";
    return "bg-green-600 dark:bg-green-400";
  };

  return (
    <div className="space-y-1">
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

      {/* Grid: 7 rows × N columns */}
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
                  className={`w-[13px] h-[13px] rounded-sm ${getColor(day.count, day.inRange)} transition-colors hover:ring-1 hover:ring-foreground/30`}
                  title={day.inRange ? `${day.date}: ${day.count} prompts` : ""}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
        <span>{data.length} days of activity</span>
        <div className="flex items-center gap-1">
          <span>Less</span>
          <div className="w-[10px] h-[10px] rounded-sm bg-secondary/50 dark:bg-secondary/30" />
          <div className="w-[10px] h-[10px] rounded-sm bg-green-200 dark:bg-green-900/60" />
          <div className="w-[10px] h-[10px] rounded-sm bg-green-400 dark:bg-green-700/80" />
          <div className="w-[10px] h-[10px] rounded-sm bg-green-500 dark:bg-green-500" />
          <div className="w-[10px] h-[10px] rounded-sm bg-green-600 dark:bg-green-400" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
