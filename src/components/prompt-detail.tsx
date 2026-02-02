"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SkeletonDetail } from "@/components/ui/skeleton";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
  tokens?: number;
}

interface PromptDetailProps {
  id: string;
  sessionId?: string;
  timestamp: Date;
  projectName?: string | null;
  workingDirectory?: string | null;
  promptType?: string | null;
  messages: Message[];
  inputTokens: number;
  outputTokens: number;
  tags?: string[];
  isLoading?: boolean;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

const roleColors: Record<string, string> = {
  user: "text-blue-400",
  assistant: "text-green-400",
  system: "text-zinc-400",
};

const roleLabels: Record<string, string> = {
  user: "You",
  assistant: "Claude",
  system: "System",
};

export function PromptDetail({
  id: _id,
  sessionId,
  timestamp,
  projectName,
  workingDirectory,
  promptType,
  messages,
  inputTokens,
  outputTokens,
  tags = [],
  isLoading = false,
}: PromptDetailProps) {
  const [copied, setCopied] = useState(false);

  const totalTokens = inputTokens + outputTokens;

  const handleCopy = async () => {
    const content = messages
      .map((m) => `[${roleLabels[m.role]}]\n${m.content}`)
      .join("\n\n---\n\n");

    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return <SkeletonDetail />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/prompts"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Prompts
        </Link>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy
              </>
            )}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="border-b border-zinc-800">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {sessionId && (
              <div className="flex items-center gap-2 text-zinc-400">
                <span className="font-medium text-zinc-300">Session:</span>
                <code className="rounded bg-zinc-800 px-2 py-0.5 text-xs">
                  {sessionId}
                </code>
              </div>
            )}
            <div className="flex items-center gap-2 text-zinc-400">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {formatDate(timestamp)}
            </div>
            {projectName && (
              <Badge variant="secondary">{projectName}</Badge>
            )}
            {promptType && (
              <Badge variant={promptType === "user_input" ? "default" : promptType === "task_notification" ? "warning" : "outline"}>
                {promptType.replace("_", " ")}
              </Badge>
            )}
          </div>
          {workingDirectory && (
            <div className="mt-2 text-xs text-zinc-500 font-mono truncate" title={workingDirectory}>
              📁 {workingDirectory}
            </div>
          )}
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Input:</span>
              <span className="text-zinc-300">{formatTokenCount(inputTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Output:</span>
              <span className="text-zinc-300">{formatTokenCount(outputTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Total:</span>
              <span className="font-medium text-zinc-100">{formatTokenCount(totalTokens)} tokens</span>
            </div>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-zinc-800">
            {messages.map((message, index) => (
              <div key={index} className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`font-medium ${roleColors[message.role]}`}>
                    {roleLabels[message.role]}
                  </span>
                  {message.timestamp && (
                    <span className="text-xs text-zinc-500">
                      {formatDate(message.timestamp)}
                    </span>
                  )}
                  {message.tokens && (
                    <span className="text-xs text-zinc-500">
                      {formatTokenCount(message.tokens)} tokens
                    </span>
                  )}
                </div>
                <div className="prose prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap font-mono text-sm text-zinc-300 bg-zinc-800/50 rounded-lg p-4 overflow-x-auto">
                    {message.content}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
