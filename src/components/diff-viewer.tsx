"use client";

import { formatDate } from "@/lib/utils";

export interface DiffSegment {
  type: "added" | "removed" | "unchanged";
  text: string;
}

export interface DiffPrompt {
  id: string;
  timestamp: string | Date;
  projectName: string | null;
  promptText: string;
  qualityScore: number | null;
}

interface DiffViewerProps {
  promptA: DiffPrompt;
  promptB: DiffPrompt;
  diff: DiffSegment[];
  similarity: number;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countSegmentWords(segments: DiffSegment[], type: DiffSegment["type"]) {
  return segments
    .filter((segment) => segment.type === type)
    .reduce((total, segment) => total + countWords(segment.text), 0);
}

/**
 * Build aligned segment pairs so left and right sides stay in sync.
 * For "removed" segments the right side gets a blank placeholder and
 * vice-versa for "added" segments.
 */
function alignSegments(
  segments: DiffSegment[]
): { left: DiffSegment | null; right: DiffSegment | null }[] {
  return segments.map((seg) => {
    if (seg.type === "unchanged") {
      return { left: seg, right: seg };
    }
    if (seg.type === "removed") {
      return { left: seg, right: null };
    }
    // added
    return { left: null, right: seg };
  });
}

function renderAlignedSide(
  pairs: { left: DiffSegment | null; right: DiffSegment | null }[],
  side: "left" | "right"
) {
  return pairs.map((pair, index) => {
    const segment = side === "left" ? pair.left : pair.right;

    if (!segment) {
      // Empty placeholder to keep alignment
      const otherSegment = side === "left" ? pair.right : pair.left;
      return (
        <span
          key={`placeholder-${index}`}
          className="bg-muted/30"
          aria-hidden="true"
        >
          {otherSegment ? otherSegment.text.replace(/\S/g, "\u00A0") : ""}
        </span>
      );
    }

    const className =
      segment.type === "added"
        ? "bg-green-100 dark:bg-green-900/30"
        : segment.type === "removed"
          ? "bg-red-100 dark:bg-red-900/30"
          : "";

    return (
      <span key={`${segment.type}-${index}`} className={className}>
        {segment.text}
      </span>
    );
  });
}

function PromptMeta({ title, prompt }: { title: string; prompt: DiffPrompt }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-2 text-sm font-semibold text-foreground">{title}</div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">Date:</span>{" "}
          {formatDate(prompt.timestamp)}
        </div>
        <div>
          <span className="font-medium text-foreground">Project:</span>{" "}
          {prompt.projectName ?? "Unknown"}
        </div>
        <div>
          <span className="font-medium text-foreground">Quality:</span>{" "}
          {prompt.qualityScore ?? "N/A"}
        </div>
      </div>
    </div>
  );
}

export function DiffViewer({ promptA, promptB, diff, similarity }: DiffViewerProps) {
  const wordsAdded = countSegmentWords(diff, "added");
  const wordsRemoved = countSegmentWords(diff, "removed");
  const similarityPercent = Math.round(similarity * 100);
  const aligned = alignSegments(diff);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid gap-3 border-b border-border bg-muted/40 p-4 md:grid-cols-2">
        <PromptMeta title="Prompt A" prompt={promptA} />
        <PromptMeta title="Prompt B" prompt={promptB} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3 text-sm">
        <span className="font-medium text-green-700 dark:text-green-300">
          {wordsAdded} words added
        </span>
        <span className="font-medium text-red-700 dark:text-red-300">
          {wordsRemoved} removed
        </span>
        <span className="text-muted-foreground">{similarityPercent}% similar</span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Prompt A</h3>
          <div className="min-h-[320px] rounded-md border border-border bg-background p-4 font-mono text-sm leading-6 whitespace-pre-wrap break-words">
            {renderAlignedSide(aligned, "left")}
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Prompt B</h3>
          <div className="min-h-[320px] rounded-md border border-border bg-background p-4 font-mono text-sm leading-6 whitespace-pre-wrap break-words">
            {renderAlignedSide(aligned, "right")}
          </div>
        </div>
      </div>
    </div>
  );
}

