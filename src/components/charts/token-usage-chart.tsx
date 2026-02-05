"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface TokenData {
  date: string;
  tokens: number;
}

interface TokenUsageChartProps {
  data: TokenData[];
}

export function TokenUsageChart({ data }: TokenUsageChartProps) {
  const formattedData = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  return (
    <div className="h-[200px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formattedData}>
          <defs>
            <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
          <XAxis
            dataKey="displayDate"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#71717a" }}
            minTickGap={30}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#71717a" }}
            tickFormatter={(value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value)}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", fontSize: "12px", color: "#f4f4f5" }}
            itemStyle={{ color: "#818cf8" }}
            labelStyle={{ color: "#71717a" }}
          />
          <Area
            type="monotone"
            dataKey="tokens"
            stroke="#818cf8"
            fillOpacity={1}
            fill="url(#colorTokens)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
