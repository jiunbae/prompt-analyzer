"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

interface TokenData {
  date: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface TokenUsageChartProps {
  data: TokenData[];
}

export function TokenUsageChart({ data }: TokenUsageChartProps) {
  const hasIOSplit = data.some((d) => (d.inputTokens ?? 0) > 0 || (d.outputTokens ?? 0) > 0);

  const formattedData = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  const formatTick = (value: number) =>
    value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

  return (
    <div className="h-[200px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formattedData}>
          <defs>
            <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="displayDate"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            minTickGap={30}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            tickFormatter={formatTick}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              borderColor: "var(--color-border)",
              fontSize: "12px",
              color: "var(--color-foreground)",
            }}
            labelStyle={{ color: "var(--color-muted-foreground)" }}
          />
          {hasIOSplit ? (
            <>
              <Legend
                verticalAlign="top"
                height={24}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "11px" }}
              />
              <Area
                type="monotone"
                dataKey="inputTokens"
                name="Input"
                stroke="#818cf8"
                fillOpacity={1}
                fill="url(#colorInput)"
                stackId="1"
              />
              <Area
                type="monotone"
                dataKey="outputTokens"
                name="Output"
                stroke="#34d399"
                fillOpacity={1}
                fill="url(#colorOutput)"
                stackId="1"
              />
            </>
          ) : (
            <Area
              type="monotone"
              dataKey="tokens"
              stroke="#818cf8"
              fillOpacity={1}
              fill="url(#colorTokens)"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
