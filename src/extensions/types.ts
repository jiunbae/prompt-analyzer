import type { AnyRouter } from "@trpc/server";
import type { ComponentType } from "react";

// ── Canonical insight output format ──────────────────────────────

export interface InsightTrend {
  metric: string;
  direction: "up" | "down" | "stable";
  magnitude: number;
  explanation: string;
}

export interface InsightHighlight {
  label: string;
  value: string | number;
}

export interface InsightResult {
  title: string;
  summary: string;
  trends?: InsightTrend[];
  recommendations?: string[];
  highlights?: InsightHighlight[];
  confidence: number; // 0-1
  generatedAt: string; // ISO timestamp
}

// ── Processor input / output ─────────────────────────────────────

export interface ProcessorInput {
  userId: string;
  dateRange: { from: string; to: string };
  parameters?: Record<string, unknown>;
}

export interface ProcessorOutput {
  insight: InsightResult;
  cached: boolean;
}

// ── Extension manifest ───────────────────────────────────────────

export interface ExtensionProcessor {
  /** cron expression for batch processing (e.g. "0 3 * * *") */
  schedule?: string;
  /** Unique job name for BullMQ */
  jobName: string;
  /** Handler that produces an insight */
  handler: (input: ProcessorInput) => Promise<InsightResult>;
}

export interface InsightCardProps {
  insight: InsightResult | null;
  loading: boolean;
  onRefresh: () => void;
}

export interface Extension {
  name: string;
  version: string;
  description: string;
  /** Cache TTL in hours for generated insights (default: 24) */
  cacheTtlHours?: number;
  /** Batch / scheduled processing */
  processor?: ExtensionProcessor;
  /** tRPC router for API access */
  router?: AnyRouter;
  /** Dashboard card component */
  dashboardCard?: ComponentType<InsightCardProps>;
}

// ── LLM provider config ──────────────────────────────────────────

export type LLMProvider = "anthropic" | "openai" | "ollama" | "custom";

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}
