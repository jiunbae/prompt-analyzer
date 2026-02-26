import type { LLMConfig } from "./types";
import { logger } from "@/lib/logger";

/**
 * Lightweight LLM client that supports multiple providers.
 * Users bring their own API key via environment variables.
 */

const VALID_PROVIDERS = new Set(["anthropic", "openai", "ollama", "custom"]);

export function getLLMConfig(): LLMConfig | null {
  const provider = process.env.OMP_LLM_PROVIDER;
  if (!provider) return null;

  if (!VALID_PROVIDERS.has(provider)) {
    logger.error({ provider, valid: [...VALID_PROVIDERS] }, "Invalid OMP_LLM_PROVIDER");
    return null;
  }

  return {
    provider: provider as LLMConfig["provider"],
    apiKey: process.env.OMP_LLM_API_KEY,
    model: process.env.OMP_LLM_MODEL || getDefaultModel(provider),
    baseUrl: process.env.OMP_LLM_BASE_URL,
    maxTokens: parseInt(process.env.OMP_LLM_MAX_TOKENS || "2048", 10),
    temperature: parseFloat(process.env.OMP_LLM_TEMPERATURE || "0.3"),
  };
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-5-20250929";
    case "openai":
      return "gpt-4o-mini";
    case "ollama":
      return "llama3.2";
    default:
      return "gpt-4o-mini";
  }
}

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  tokensUsed?: number;
}

/**
 * Call the configured LLM provider with a list of messages.
 * Returns the assistant's text response.
 */
export async function callLLM(
  messages: LLMMessage[],
  config?: LLMConfig,
): Promise<LLMResponse> {
  const cfg = config || getLLMConfig();
  if (!cfg) {
    throw new Error(
      "LLM not configured. Set OMP_LLM_PROVIDER and OMP_LLM_API_KEY environment variables.",
    );
  }

  switch (cfg.provider) {
    case "anthropic":
      return callAnthropic(messages, cfg);
    case "openai":
    case "custom":
      return callOpenAICompatible(messages, cfg);
    case "ollama":
      return callOpenAICompatible(messages, {
        ...cfg,
        baseUrl: cfg.baseUrl || "http://localhost:11434/v1",
      });
    default:
      throw new Error(`Unknown LLM provider: ${cfg.provider}`);
  }
}

async function callAnthropic(
  messages: LLMMessage[],
  cfg: LLMConfig,
): Promise<LLMResponse> {
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: cfg.maxTokens || 2048,
    temperature: cfg.temperature ?? 0.3,
    messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemMsg) {
    body.system = systemMsg.content;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content =
    data.content
      ?.filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("") || "";

  return {
    content,
    model: data.model || cfg.model,
    tokensUsed: data.usage
      ? (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
      : undefined,
  };
}

async function callOpenAICompatible(
  messages: LLMMessage[],
  cfg: LLMConfig,
): Promise<LLMResponse> {
  const baseUrl = cfg.baseUrl || "https://api.openai.com/v1";

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens || 2048,
      temperature: cfg.temperature ?? 0.3,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI-compatible API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    model: data.model || cfg.model,
    tokensUsed: data.usage
      ? (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0)
      : undefined,
  };
}
