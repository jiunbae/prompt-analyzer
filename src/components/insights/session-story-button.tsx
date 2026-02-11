"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface InsightHighlight {
  label: string;
  value: string | number;
}

interface InsightTrend {
  metric: string;
  direction: "up" | "down" | "stable";
  magnitude: number;
  explanation: string;
}

interface InsightResult {
  title: string;
  summary: string;
  trends?: InsightTrend[];
  recommendations?: string[];
  highlights?: InsightHighlight[];
  confidence: number;
  generatedAt: string;
}

function TrendArrow({ direction }: { direction: "up" | "down" | "stable" }) {
  if (direction === "up") {
    return (
      <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    );
  }
  if (direction === "down") {
    return (
      <svg className="h-4 w-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
    </svg>
  );
}

export function SessionStoryButton({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateStory = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/insights/session/${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const data: InsightResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate story");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  return (
    <div className="space-y-4">
      {!result && (
        <Button
          onClick={generateStory}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating Story...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Generate Session Story
            </span>
          )}
        </Button>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="h-5 w-48 animate-pulse rounded bg-skeleton" />
            <div className="h-3 w-full animate-pulse rounded bg-skeleton" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-skeleton" />
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-foreground">{result.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{result.summary}</p>
              </div>
              <Button
                onClick={generateStory}
                variant="ghost"
                size="sm"
                disabled={loading}
                className="shrink-0"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </Button>
            </div>

            {result.highlights && result.highlights.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {result.highlights.map((h, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-card p-2"
                  >
                    <p className="text-xs text-muted-foreground">{h.label}</p>
                    <p className="text-sm font-medium text-foreground">{h.value}</p>
                  </div>
                ))}
              </div>
            )}

            {result.trends && result.trends.length > 0 && (
              <div className="space-y-1">
                {result.trends.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <TrendArrow direction={t.direction} />
                    <span className="font-medium text-foreground">{t.metric}</span>
                    <span className="text-muted-foreground">{t.explanation}</span>
                  </div>
                ))}
              </div>
            )}

            {result.recommendations && result.recommendations.length > 0 && (
              <ul className="space-y-1">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <svg className="h-4 w-4 mt-0.5 shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    {r}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                Confidence: {Math.round(result.confidence * 100)}%
              </Badge>
              <span>
                Generated {new Date(result.generatedAt).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
