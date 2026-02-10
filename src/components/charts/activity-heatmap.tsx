"use client";

interface ActivityData {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  data: ActivityData[];
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  
  const getIntensity = (count: number) => {
    if (count === 0) return "bg-secondary/50";
    if (count < maxCount * 0.25) return "bg-indigo-900/40";
    if (count < maxCount * 0.5) return "bg-indigo-700/60";
    if (count < maxCount * 0.75) return "bg-indigo-500/80";
    return "bg-indigo-400";
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {data.map((day) => (
          <div
            key={day.date}
            className={`w-3 h-3 rounded-sm ${getIntensity(day.count)} transition-colors hover:ring-1 hover:ring-border cursor-help`}
            title={`${day.date}: ${day.count} prompts`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Last 30 days</span>
        <div className="flex items-center gap-1">
          <span>Less</span>
          <div className="w-2 h-2 rounded-sm bg-secondary/50" />
          <div className="w-2 h-2 rounded-sm bg-indigo-900/40" />
          <div className="w-2 h-2 rounded-sm bg-indigo-700/60" />
          <div className="w-2 h-2 rounded-sm bg-indigo-500/80" />
          <div className="w-2 h-2 rounded-sm bg-indigo-400" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
