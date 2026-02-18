"use client";

import { useState } from "react";
import Link from "next/link";
import { MarkdownContent } from "@/components/markdown-content";

interface SharedPromptViewProps {
  promptText: string;
  responseText: string | null;
  timestamp: string;
  projectName: string | null;
  source: string | null;
  promptType: string | null;
  qualityScore: number | null;
  tokenEstimate: number | null;
  tokenEstimateResponse: number | null;
}

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

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

export function SharedPromptView({
  promptText,
  responseText,
  timestamp,
  projectName,
  source,
  promptType,
  qualityScore,
  tokenEstimate,
  tokenEstimateResponse,
}: SharedPromptViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    let content = `[User]\n${promptText}`;
    if (responseText) {
      content += `\n\n---\n\n[Assistant]\n${responseText}`;
    }
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-foreground hover:text-foreground/80 transition-colors">
            <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="font-semibold">Oh My Prompt</span>
          </Link>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            {copied ? (
              <>
                <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {/* Metadata bar */}
          <div className="border-b border-border px-6 py-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatDate(timestamp)}
              </div>
              {projectName && (
                <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  {projectName}
                </span>
              )}
              {source && (
                <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  {source}
                </span>
              )}
              {promptType && (
                <span className="inline-flex items-center rounded-full border border-blue-600/30 bg-blue-600/20 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                  {promptType.replace("_", " ")}
                </span>
              )}
              {qualityScore !== null && (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  qualityScore >= 80
                    ? "border-green-600/30 bg-green-600/20 text-green-400"
                    : qualityScore >= 50
                    ? "border-yellow-600/30 bg-yellow-600/20 text-yellow-400"
                    : "border-red-600/30 bg-red-600/20 text-red-400"
                }`}>
                  Quality: {qualityScore}/100
                </span>
              )}
            </div>
            {(tokenEstimate || tokenEstimateResponse) && (
              <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                {tokenEstimate && (
                  <span>Input: {formatTokenCount(tokenEstimate)} tokens</span>
                )}
                {tokenEstimateResponse && (
                  <span>Output: {formatTokenCount(tokenEstimateResponse)} tokens</span>
                )}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="divide-y divide-border">
            {/* User prompt */}
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-medium text-blue-400">You</span>
              </div>
              <div className="prose prose-invert max-w-none">
                <MarkdownContent content={promptText} />
              </div>
            </div>

            {/* Response */}
            {responseText && (
              <div className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-medium text-green-400">Assistant</span>
                </div>
                <div className="prose prose-invert max-w-none">
                  <MarkdownContent content={responseText} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer branding */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            Shared via{" "}
            <Link
              href="/"
              className="text-primary hover:text-primary/80 transition-colors font-medium"
            >
              Oh My Prompt
            </Link>{" "}
            -- Prompt journal and insight dashboard for better agent instructions
          </p>
        </div>
      </main>
    </div>
  );
}
