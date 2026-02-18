"use client";

import { useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SearchMode = "keyword" | "semantic" | "hybrid";

interface SearchResult {
  id: string;
  timestamp: string;
  projectName: string | null;
  promptText: string;
  source: string | null;
  sessionId: string | null;
  score: number;
  matchType: SearchMode;
}

interface SearchResponse {
  results: SearchResult[];
  mode: SearchMode;
  totalResults: number;
  query: string;
}

const modeLabels: Record<SearchMode, string> = {
  keyword: "Keyword",
  semantic: "Semantic",
  hybrid: "Hybrid",
};

const modeDescriptions: Record<SearchMode, string> = {
  keyword: "Full-text search using PostgreSQL tsvector. Best for exact keyword matches.",
  semantic: "Trigram similarity search. Finds prompts with similar character patterns, even with typos.",
  hybrid: "Combines keyword ranking (40%) with trigram similarity (60%) for best overall results.",
};

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

function formatScore(score: number): string {
  return (score * 100).toFixed(1) + "%";
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;

      // Abort any in-flight request to prevent stale results
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);
      setSearched(true);
      setResults([]);
      setTotalResults(0);

      try {
        const params = new URLSearchParams({
          q: trimmed,
          mode,
          limit: "30",
        });
        const res = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Search failed");
        }
        const data: SearchResponse = await res.json();
        setResults(data.results);
        setTotalResults(data.totalResults);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
        setTotalResults(0);
      } finally {
        if (abortControllerRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [query, mode]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Find prompts by keyword, similarity, or both
        </p>
      </div>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <Input
              type="search"
              placeholder="Search your prompts..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit" disabled={loading || !query.trim()}>
            {loading ? "Searching..." : "Search"}
          </Button>
        </div>

        {/* Search mode selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Mode:</span>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {(["keyword", "semantic", "hybrid"] as SearchMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={modeDescriptions[m]}
              >
                {modeLabels[m]}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {modeDescriptions[mode]}
          </span>
        </div>
      </form>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          <p className="font-medium">Search error</p>
          <p className="mt-1 text-red-400/80">{error}</p>
        </div>
      )}

      {searched && !loading && !error && (
        <p className="text-sm text-muted-foreground">
          {totalResults} result{totalResults !== 1 ? "s" : ""} found
          {totalResults > 0 && (
            <span> using <span className="font-medium text-foreground">{modeLabels[mode]}</span> search</span>
          )}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <Link
              key={result.id}
              href={`/prompts/${result.id}`}
              className="block"
            >
              <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <p className="text-sm text-foreground line-clamp-3 whitespace-pre-line flex-1">
                      {result.promptText}
                    </p>
                    <Badge
                      variant={result.score > 0.5 ? "success" : result.score > 0.2 ? "warning" : "secondary"}
                      className="shrink-0"
                    >
                      {formatScore(result.score)}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDate(result.timestamp)}</span>
                    {result.projectName && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <Badge variant="secondary">{result.projectName}</Badge>
                      </>
                    )}
                    {result.source && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <Badge variant="outline">{result.source}</Badge>
                      </>
                    )}
                    {result.sessionId && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="text-muted-foreground/70">
                          Session: {result.sessionId.slice(0, 8)}...
                        </span>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {searched && !loading && !error && results.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p>No results found for &quot;{query}&quot;</p>
          <p className="text-sm mt-1">
            Try a different search term or switch to{" "}
            {mode === "keyword" ? "Semantic" : mode === "semantic" ? "Hybrid" : "Keyword"} mode.
          </p>
        </div>
      )}

      {!searched && (
        <div className="text-center py-12 text-muted-foreground">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p>Enter a search query to find prompts</p>
          <p className="text-sm mt-2">
            <span className="font-medium">Keyword</span> finds exact matches.{" "}
            <span className="font-medium">Semantic</span> finds similar text.{" "}
            <span className="font-medium">Hybrid</span> combines both.
          </p>
        </div>
      )}
    </div>
  );
}
