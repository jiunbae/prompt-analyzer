"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SkeletonDetail } from "@/components/ui/skeleton";
import { MarkdownContent } from "@/components/markdown-content";
import { useRouter } from "next/navigation";

interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

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
  tags?: Tag[];
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
  system: "text-muted-foreground",
};

const roleLabels: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  system: "System",
};

interface ShareLink {
  id: string;
  shareToken: string;
  viewCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

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
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState<string | null>(null);
  const [shareExpiry, setShareExpiry] = useState<string>("never");

  const totalTokens = inputTokens + outputTokens;

  const fetchShareLinks = useCallback(async () => {
    try {
      const res = await fetch("/api/share");
      if (res.ok) {
        const data = await res.json();
        // Filter to only show shares for this prompt
        const promptShares = data.shares.filter(
          (s: { promptId: string }) => s.promptId === _id
        );
        setShareLinks(promptShares);
      }
    } catch (error) {
      console.error("Failed to fetch share links:", error);
    }
  }, [_id]);

  useEffect(() => {
    if (showSharePanel) {
      fetchShareLinks();
    }
  }, [showSharePanel, fetchShareLinks]);

  const handleCreateShareLink = async () => {
    setShareLoading(true);
    try {
      const expiresIn = shareExpiry === "never" ? null : parseInt(shareExpiry);
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: _id, expiresIn }),
      });
      if (res.ok) {
        await fetchShareLinks();
      }
    } catch (error) {
      console.error("Failed to create share link:", error);
    } finally {
      setShareLoading(false);
    }
  };

  const handleRevokeShareLink = async (id: string) => {
    try {
      const res = await fetch(`/api/share?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchShareLinks();
      }
    } catch (error) {
      console.error("Failed to revoke share link:", error);
    }
  };

  const copyShareLink = async (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    await navigator.clipboard.writeText(url);
    setShareCopied(token);
    setTimeout(() => setShareCopied(null), 2000);
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this prompt? This action cannot be undone.")) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/prompts/${_id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/sessions");
        router.refresh();
      } else {
        alert("Failed to delete prompt");
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("An error occurred while deleting");
    } finally {
      setIsDeleting(false);
    }
  };

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
          href="/sessions"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <title>Back Icon</title>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSharePanel(!showSharePanel)}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <title>Share Icon</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
            Share
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <title>Delete Icon</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>

          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <title>Checkmark Icon</title>
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
                  <title>Copy Icon</title>
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

      {/* Share panel */}
      {showSharePanel && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">Share this prompt</h3>
              <div className="flex items-center gap-2">
                <select
                  value={shareExpiry}
                  onChange={(e) => setShareExpiry(e.target.value)}
                  className="h-8 rounded-md border border-border bg-input-bg px-2 text-xs text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="never">No expiry</option>
                  <option value="1">1 hour</option>
                  <option value="24">24 hours</option>
                  <option value="168">7 days</option>
                  <option value="720">30 days</option>
                </select>
                <Button size="sm" onClick={handleCreateShareLink} disabled={shareLoading}>
                  {shareLoading ? "Creating..." : "Create Link"}
                </Button>
              </div>
            </div>

            {shareLinks.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Active share links:</p>
                {shareLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <code className="text-xs text-muted-foreground truncate block">
                        {typeof window !== "undefined"
                          ? `${window.location.origin}/share/${link.shareToken}`
                          : `/share/${link.shareToken}`}
                      </code>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{link.viewCount} views</span>
                        {link.expiresAt && (
                          <span>
                            Expires: {new Date(link.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                        {!link.isActive && (
                          <Badge variant="error">Revoked</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyShareLink(link.shareToken)}
                      >
                        {shareCopied === link.shareToken ? (
                          <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </Button>
                      {link.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeShareLink(link.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {sessionId && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="font-medium text-secondary-foreground">Session:</span>
                <Link
                  href={`/sessions/${sessionId}`}
                  className="rounded bg-secondary px-2 py-0.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  View full session
                </Link>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <title>Timestamp Icon</title>
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
            <div className="mt-2 text-xs text-muted-foreground font-mono truncate" title={workingDirectory}>
              📁 {workingDirectory}
            </div>
          )}
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Input:</span>
              <span className="text-secondary-foreground">{formatTokenCount(inputTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Output:</span>
              <span className="text-secondary-foreground">{formatTokenCount(outputTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-medium text-foreground">{formatTokenCount(totalTokens)} tokens</span>
            </div>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  style={tag.color ? { backgroundColor: `${tag.color}22`, color: tag.color, borderColor: tag.color } : undefined}
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {messages.map((message) => (
              <div key={message.timestamp?.getTime() || message.content} className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`font-medium ${roleColors[message.role]}`}>
                    {roleLabels[message.role]}
                  </span>
                  {message.timestamp && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(message.timestamp)}
                    </span>
                  )}
                  {message.tokens && (
                    <span className="text-xs text-muted-foreground">
                      {formatTokenCount(message.tokens)} tokens
                    </span>
                  )}
                </div>
                <div className="prose prose-invert max-w-none">
                  <MarkdownContent content={message.content} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
