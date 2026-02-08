"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface ProjectActivityDatum {
  project: string;
  count: number;
}

interface ProjectActivityChartProps {
  data: ProjectActivityDatum[];
}

function truncate(label: string, max: number) {
  if (label.length <= max) return label;
  return label.slice(0, max - 3) + "...";
}

export function ProjectActivityChart({ data }: ProjectActivityChartProps) {
  const formattedData = data.map((d) => ({
    ...d,
    displayProject: truncate(d.project || "No project", 18),
  }));

  return (
    <div className="h-[240px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formattedData} layout="vertical" margin={{ left: 10, right: 10 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#27272a" />
          <XAxis
            type="number"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#71717a" }}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="displayProject"
            axisLine={false}
            tickLine={false}
            width={110}
            tick={{ fontSize: 10, fill: "#71717a" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              borderColor: "#27272a",
              fontSize: "12px",
              color: "#f4f4f5",
            }}
            itemStyle={{ color: "#818cf8" }}
            labelStyle={{ color: "#a1a1aa" }}
            formatter={(value) => [`${value}`, "Prompts"]}
          />
          <Bar dataKey="count" fill="#818cf8" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
