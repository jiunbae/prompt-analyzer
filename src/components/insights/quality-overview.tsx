"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface QualityStats {
  averageScore: number;
  totalEnriched: number;
  totalUnenriched: number;
  distribution: {
    low: number;
    medium: number;
    good: number;
    excellent: number;
  };
  topTopics: Array<{ tag: string; count: number }>;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const remaining = circumference - progress;

  const color =
    score >= 76
      ? "#22c55e"
      : score >= 51
        ? "#3b82f6"
        : score >= 26
          ? "#eab308"
          : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="8"
        />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${remaining}`}
          strokeDashoffset={circumference * 0.25}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-foreground">{score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

function DistributionBar({
  distribution,
}: {
  distribution: QualityStats["distribution"];
}) {
  const total =
    distribution.low +
    distribution.medium +
    distribution.good +
    distribution.excellent;

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">No scored prompts yet.</p>
    );
  }

  const segments = [
    { key: "excellent", label: "Excellent (76-100)", count: distribution.excellent, color: "bg-green-500" },
    { key: "good", label: "Good (51-75)", count: distribution.good, color: "bg-blue-500" },
    { key: "medium", label: "Medium (26-50)", count: distribution.medium, color: "bg-yellow-500" },
    { key: "low", label: "Low (0-25)", count: distribution.low, color: "bg-red-500" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((seg) => {
          const pct = (seg.count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={seg.key}
              className={`${seg.color} transition-all duration-500`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${seg.count}`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${seg.color}`} />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="ml-auto font-medium text-foreground">{seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TOPIC_BADGE_VARIANTS: Record<string, "default" | "secondary" | "success" | "warning" | "error" | "outline"> = {
  debugging: "error",
  feature: "success",
  refactoring: "warning",
  devops: "secondary",
  testing: "default",
  documentation: "outline",
  architecture: "default",
  performance: "warning",
  security: "error",
  ui: "success",
  data: "secondary",
  config: "outline",
  other: "outline",
};

export function QualityOverview() {
  const [stats, setStats] = useState<QualityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/insights/quality");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: QualityStats = await res.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleEnrich = async () => {
    try {
      setEnriching(true);
      setError(null);
      const res = await fetch("/api/insights/quality", { method: "POST" });
      if (!res.ok) {
        throw new Error(`Enrichment failed (HTTP ${res.status})`);
      }
      // Refresh stats after enrichment
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-6">
            <Skeleton className="h-32 w-32 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Prompt Quality</CardTitle>
          <CardDescription>Quality analysis of your prompts</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={fetchStats}
            className="mt-2 text-sm text-blue-400 hover:underline"
          >
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Prompt Quality</CardTitle>
          <CardDescription>
            {stats.totalEnriched} prompts scored
            {stats.totalUnenriched > 0 && (
              <span className="text-yellow-400">
                {" "}
                ({stats.totalUnenriched} pending)
              </span>
            )}
          </CardDescription>
        </div>
        {stats.totalUnenriched > 0 && (
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {enriching ? "Scoring..." : "Score Now"}
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Score ring + distribution */}
        <div className="flex items-start gap-6">
          <ScoreRing score={stats.averageScore} />
          <div className="flex-1 min-w-0">
            <p className="mb-3 text-sm font-medium text-foreground">
              Quality Distribution
            </p>
            <DistributionBar distribution={stats.distribution} />
          </div>
        </div>

        {/* Topic tags */}
        {stats.topTopics.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              Top Topics
            </p>
            <div className="flex flex-wrap gap-2">
              {stats.topTopics.map((t) => (
                <Badge
                  key={t.tag}
                  variant={TOPIC_BADGE_VARIANTS[t.tag] || "outline"}
                >
                  {t.tag}
                  <span className="ml-1.5 opacity-70">{t.count}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
