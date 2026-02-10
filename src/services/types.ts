/**
 * Prompt type classification
 */
export type PromptType = "task_notification" | "system" | "user_input";

/**
 * Extracted metadata from a prompt
 */
export interface PromptMetadata {
  projectName: string | null;
  promptType: PromptType;
  tokenEstimate: number;
  wordCount: number;
}
