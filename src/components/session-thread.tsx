"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownContent } from "@/components/markdown-content";

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

interface PromptData {
  id: string;
  timestamp: string;
  promptText: string;
  responseText: string | null;
  tokenEstimate: number | null;
  tokenEstimateResponse: number | null;
  promptTags: { tag: { id: string; name: string; color: string | null } }[];
}

interface SessionThreadProps {
  prompts: PromptData[];
  responseCount: number;
}

export function SessionThread({ prompts, responseCount }: SessionThreadProps) {
  const [showResponses, setShowResponses] = useState(true);

  return (
    <div className="space-y-6">
      {responseCount > 0 && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => setShowResponses(!showResponses)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card text-secondary-foreground hover:bg-surface transition-colors"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${showResponses ? "" : "-rotate-90"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {showResponses ? "Hide" : "Show"} Responses ({responseCount})
          </button>
        </div>
      )}

      {prompts.map((prompt) => (
        <div key={prompt.id} className="space-y-0">
          {/* User message */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-medium text-blue-400">You</span>
                <span className="text-xs text-muted-foreground">{formatDate(prompt.timestamp)}</span>
                {prompt.tokenEstimate && (
                  <span className="text-xs text-muted-foreground">
                    {formatTokens(prompt.tokenEstimate)} tokens
                  </span>
                )}
                <Link
                  href={`/prompts/${prompt.id}`}
                  className="ml-auto text-xs text-muted-foreground hover:text-secondary-foreground transition-colors"
                >
                  View detail
                </Link>
              </div>
              <div className="prose prose-invert max-w-none">
                <MarkdownContent content={prompt.promptText} />
              </div>
              {prompt.promptTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {prompt.promptTags.map((pt) => (
                    <Badge
                      key={pt.tag.id}
                      variant="secondary"
                      style={pt.tag.color ? { backgroundColor: `${pt.tag.color}22`, color: pt.tag.color, borderColor: pt.tag.color } : undefined}
                    >
                      {pt.tag.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assistant response */}
          {showResponses && prompt.responseText && (
            <Card className="border-l-2 border-l-green-800 ml-4">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-medium text-green-400">Assistant</span>
                  {prompt.tokenEstimateResponse && (
                    <span className="text-xs text-muted-foreground">
                      {formatTokens(prompt.tokenEstimateResponse)} tokens
                    </span>
                  )}
                </div>
                <div className="prose prose-invert max-w-none">
                  <MarkdownContent content={prompt.responseText} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ))}
    </div>
  );
}
