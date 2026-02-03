import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility function for combining Tailwind CSS classes
 * Uses clsx for conditional classes and tailwind-merge for deduplication
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extract project name from working directory path
 * Supports common patterns like /Users/{user}/workspace/{project} or /home/{user}/{project}
 */
export function extractProjectName(workingDirectory: string): string | null {
  // Try common patterns:
  // - /Users/{user}/workspace/{project}/...
  // - /Users/{user}/{project}/...
  // - /home/{user}/workspace/{project}/...
  // - /home/{user}/{project}/...
  const patterns = [
    /\/(?:Users|home)\/[^/]+\/workspace\/([^/]+)/,
    /\/(?:Users|home)\/[^/]+\/([^/]+)/,
  ];

  for (const pattern of patterns) {
    const match = workingDirectory.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Detect prompt type based on content
 */
export function detectPromptType(
  prompt: string
): "task_notification" | "system" | "user_input" {
  if (prompt.includes("<task-notification>")) return "task_notification";
  if (prompt.includes("<system-reminder>")) return "system";
  return "user_input";
}

/**
 * Estimate token count from text
 * Rough estimate: ~4 characters per token for English
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Count words in text
 */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

/**
 * Format date to display string
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + "...";
}
