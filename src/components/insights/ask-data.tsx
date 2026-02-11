"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface InsightTrend {
  metric: string;
  direction: "up" | "down" | "stable";
  magnitude: number;
  explanation: string;
}

interface InsightHighlight {
  label: string;
  value: string | number;
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

const EXAMPLE_QUESTIONS = [
  "What did I work on last week?",
  "Which project uses the most tokens?",
  "Show my busiest day",
  "What are my most common prompt types?",
  "How has my usage changed over time?",
];

const STORAGE_KEY = "omp-ask-data-recent";
const MAX_RECENT = 5;

function getRecentQuestions(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentQuestion(question: string) {
  try {
    const recent = getRecentQuestions().filter((q) => q !== question);
    recent.unshift(question);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // localStorage may be unavailable
  }
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

function InsightResultDisplay({ result }: { result: InsightResult }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{result.title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{result.summary}</p>
      </div>

      {result.highlights && result.highlights.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Highlights</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {result.highlights.map((h, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-3"
              >
                <p className="text-xs text-muted-foreground">{h.label}</p>
                <p className="text-sm font-medium text-foreground mt-0.5">
                  {h.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.trends && result.trends.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Trends</h4>
          <div className="space-y-2">
            {result.trends.map((t, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
              >
                <TrendArrow direction={t.direction} />
                <span className="font-medium text-foreground">{t.metric}</span>
                <span className="text-muted-foreground">{t.explanation}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.recommendations && result.recommendations.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Recommendations</h4>
          <ul className="space-y-1">
            {result.recommendations.map((r, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <svg className="h-4 w-4 mt-0.5 shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          Confidence: {Math.round(result.confidence * 100)}%
        </Badge>
        <span>
          Generated {new Date(result.generatedAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function AskData() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InsightResult | null>(null);
  const [recentQuestions, setRecentQuestions] = useState<string[]>([]);

  useEffect(() => {
    setRecentQuestions(getRecentQuestions());
  }, []);

  const askQuestion = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/insights/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const data: InsightResult = await res.json();
      setResult(data);
      saveRecentQuestion(trimmed);
      setRecentQuestions(getRecentQuestions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    askQuestion(question);
  };

  const handleChipClick = (q: string) => {
    setQuestion(q);
    askQuestion(q);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask Your Data</CardTitle>
        <CardDescription>
          Ask a natural language question about your prompt history
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What did I work on last week?"
            disabled={loading}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !question.trim()}>
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Thinking...
              </span>
            ) : (
              "Ask"
            )}
          </Button>
        </form>

        {/* Example question chips */}
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => handleChipClick(q)}
              disabled={loading}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Recent questions */}
        {recentQuestions.length > 0 && !result && !loading && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Recent questions</p>
            <div className="flex flex-wrap gap-2">
              {recentQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => handleChipClick(q)}
                  disabled={loading}
                  className="rounded-full border border-blue-600/30 bg-blue-600/10 px-3 py-1 text-xs text-blue-400 transition-colors hover:bg-blue-600/20 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="space-y-3 py-4">
            <div className="h-4 w-48 animate-pulse rounded bg-skeleton" />
            <div className="h-3 w-full animate-pulse rounded bg-skeleton" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-skeleton" />
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="h-16 animate-pulse rounded-lg bg-skeleton" />
              <div className="h-16 animate-pulse rounded-lg bg-skeleton" />
              <div className="h-16 animate-pulse rounded-lg bg-skeleton" />
            </div>
          </div>
        )}

        {/* Result */}
        {result && !loading && <InsightResultDisplay result={result} />}
      </CardContent>
    </Card>
  );
}
