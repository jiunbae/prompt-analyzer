"use client";

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

type DimensionScores = {
  clarity: number;
  specificity: number;
  context: number;
  constraints: number;
  structure: number;
};

type DimensionKey = keyof DimensionScores;

interface QualityBreakdownProps {
  current: DimensionScores;
  average: DimensionScores;
  className?: string;
}

const DIMENSIONS: Array<{ key: DimensionKey; label: string }> = [
  { key: "clarity", label: "Clarity" },
  { key: "specificity", label: "Specificity" },
  { key: "context", label: "Context" },
  { key: "constraints", label: "Constraints" },
  { key: "structure", label: "Structure" },
];

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function colorForScore(score: number) {
  if (score < 40) {
    return {
      stroke: "#ef4444",
      fill: "#ef4444",
      text: "text-red-500",
      label: "Needs work",
    };
  }

  if (score <= 70) {
    return {
      stroke: "#eab308",
      fill: "#eab308",
      text: "text-yellow-500",
      label: "Moderate",
    };
  }

  return {
    stroke: "#22c55e",
    fill: "#22c55e",
    text: "text-green-500",
    label: "Strong",
  };
}

export function QualityBreakdown({ current, average, className }: QualityBreakdownProps) {
  // Weighted mean matching backend: clarity 0.25, specificity 0.25,
  // context 0.20, constraints 0.15, structure 0.15
  const currentAverage = clampScore(
    current.clarity * 0.25 +
      current.specificity * 0.25 +
      current.context * 0.2 +
      current.constraints * 0.15 +
      current.structure * 0.15,
  );

  const palette = colorForScore(currentAverage);
  const radarData = DIMENSIONS.map(({ key, label }) => ({
    dimension: label,
    current: clampScore(current[key]),
    average: clampScore(average[key]),
  }));

  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Quality Breakdown</p>
          <p className="text-xs text-muted-foreground">
            Five-dimensional prompt quality profile
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Current overall</p>
          <p className={cn("text-lg font-semibold", palette.text)}>{currentAverage}/100</p>
        </div>
      </div>

      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} outerRadius="68%">
            <PolarGrid stroke="var(--color-border)" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tickCount={6}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
            />
            <Radar
              name="Current"
              dataKey="current"
              stroke={palette.stroke}
              fill={palette.fill}
              fillOpacity={0.28}
              strokeWidth={2}
            />
            <Radar
              name="Average"
              dataKey="average"
              stroke="var(--color-muted-foreground)"
              fillOpacity={0}
              strokeDasharray="6 4"
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: palette.fill }}
            />
            <span>Current ({palette.label})</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-muted-foreground" />
            <span>Average (dashed)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DIMENSIONS.map(({ key, label }) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium text-foreground">
                {clampScore(current[key])}
                <span className="text-muted-foreground"> / avg {clampScore(average[key])}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
