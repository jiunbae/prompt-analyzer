import type { ProcessorInput, InsightResult, InsightHighlight } from "../types";
import { callLLM, getLLMConfig } from "../llm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and, asc, desc, sql } from "drizzle-orm";

interface SessionPrompt {
  index: number;
  timestamp: string;
  prompt_summary: string;
  response_summary: string;
  type: string;
}

interface SessionContext {
  session_id: string;
  project: string | null;
  duration_minutes: number;
  prompt_count: number;
  prompts: SessionPrompt[];
}

function truncateText(text: string | null, length: number): string {
  if (!text) return "";
  if (text.length <= length) return text;
  return text.slice(0, length) + "...";
}

async function getSessionPrompts(
  userId: string,
  sessionId: string,
): Promise<typeof schema.prompts.$inferSelect[]> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    const prompts = await db
      .select()
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, userId),
          eq(schema.prompts.sessionId, sessionId),
        ),
      )
      .orderBy(asc(schema.prompts.timestamp));

    return prompts;
  } finally {
    await client.end();
  }
}

async function getRecentSessionId(userId: string): Promise<string | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    const [row] = await db
      .select({ sessionId: schema.prompts.sessionId })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, userId),
          sql`${schema.prompts.sessionId} IS NOT NULL`,
        ),
      )
      .orderBy(desc(schema.prompts.timestamp))
      .limit(1);

    return row?.sessionId ?? null;
  } finally {
    await client.end();
  }
}

function buildSessionContext(
  sessionId: string,
  prompts: typeof schema.prompts.$inferSelect[],
): SessionContext {
  if (prompts.length === 0) {
    return {
      session_id: sessionId,
      project: null,
      duration_minutes: 0,
      prompt_count: 0,
      prompts: [],
    };
  }

  const first = prompts[0];
  const last = prompts[prompts.length - 1];
  const durationMs = last.timestamp.getTime() - first.timestamp.getTime();
  const durationMinutes = Math.round(durationMs / 60_000);

  return {
    session_id: sessionId,
    project: first.projectName,
    duration_minutes: durationMinutes,
    prompt_count: prompts.length,
    prompts: prompts.map((p, i) => ({
      index: i + 1,
      timestamp: p.timestamp.toISOString(),
      prompt_summary: truncateText(p.promptText, 200),
      response_summary: truncateText(p.responseText, 200),
      type: p.promptType || "user_input",
    })),
  };
}

function buildFallbackResult(
  sessionId: string,
  prompts: typeof schema.prompts.$inferSelect[],
): InsightResult {
  if (prompts.length === 0) {
    return {
      title: "Empty Session",
      summary: `Session ${sessionId} contains no prompts.`,
      confidence: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const first = prompts[0];
  const last = prompts[prompts.length - 1];
  const durationMs = last.timestamp.getTime() - first.timestamp.getTime();
  const durationMinutes = Math.round(durationMs / 60_000);
  const totalInputTokens = prompts.reduce(
    (sum, p) => sum + (p.tokenEstimate ?? Math.ceil(p.promptLength / 4)),
    0,
  );
  const totalOutputTokens = prompts.reduce(
    (sum, p) => sum + (p.tokenEstimateResponse ?? 0),
    0,
  );
  const projects = [
    ...new Set(prompts.map((p) => p.projectName).filter(Boolean)),
  ];
  const responsesCount = prompts.filter((p) => p.responseText).length;

  const highlights: InsightHighlight[] = [
    { label: "Duration", value: `${durationMinutes} minutes` },
    { label: "Prompts", value: prompts.length },
    { label: "Responses", value: responsesCount },
    { label: "Input Tokens", value: totalInputTokens },
    { label: "Output Tokens", value: totalOutputTokens },
  ];

  if (projects.length > 0) {
    highlights.push({ label: "Projects", value: projects.join(", ") });
  }

  const firstPromptSummary = truncateText(first.promptText, 100);
  const lastPromptSummary = truncateText(last.promptText, 100);

  return {
    title: `Session: ${first.projectName || sessionId.slice(0, 8)}`,
    summary: `A ${durationMinutes}-minute session with ${prompts.length} prompts and ${responsesCount} responses. Started with: "${firstPromptSummary}" and ended with: "${lastPromptSummary}"`,
    highlights,
    recommendations: [
      "Configure an LLM provider (OMP_LLM_PROVIDER) for richer AI-generated session narratives.",
    ],
    confidence: 0.3,
    generatedAt: new Date().toISOString(),
  };
}

export async function handler(input: ProcessorInput): Promise<InsightResult> {
  const sessionId =
    (input.parameters?.sessionId as string) ||
    (await getRecentSessionId(input.userId));

  if (!sessionId) {
    return {
      title: "No Sessions Found",
      summary:
        "No sessions with a session ID were found for your account. Sessions are created when prompts share a session ID.",
      confidence: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const prompts = await getSessionPrompts(input.userId, sessionId);

  if (prompts.length === 0) {
    return {
      title: "Empty Session",
      summary: `Session ${sessionId} contains no prompts for your account.`,
      confidence: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const llmConfig = getLLMConfig();
  if (!llmConfig) {
    return buildFallbackResult(sessionId, prompts);
  }

  const context = buildSessionContext(sessionId, prompts);

  try {
    const response = await callLLM(
      [
        {
          role: "system",
          content: `You are an AI analyst for a developer productivity tool called "Oh My Prompt". You analyze coding sessions to generate narrative stories about what a developer accomplished.

You must return ONLY valid JSON in this exact format:
{
  "title": "A short theme/title for the session (max 60 chars)",
  "summary": "A 2-3 sentence narrative of what happened in this session",
  "highlights": [
    { "label": "Key Moment", "value": "description" },
    { "label": "Decision", "value": "description" }
  ],
  "recommendations": [
    "Suggestion for what could be improved or done differently"
  ],
  "trends": [
    { "metric": "metric name", "direction": "up|down|stable", "magnitude": 0.5, "explanation": "brief explanation" }
  ],
  "confidence": 0.8
}

Guidelines:
- The title should capture the main theme of the session (e.g., "Debugging Auth Flow", "Building Dashboard UI")
- The summary should tell a narrative: what was the goal, how did it progress, what was the outcome
- Highlights should capture 3-5 key moments or decisions in the session
- Recommendations should be actionable suggestions (1-3 items)
- Trends should reflect session patterns (complexity, pace, etc.)
- Confidence should reflect how well you could understand the session (0-1)
- Do NOT include any text outside the JSON object`,
        },
        {
          role: "user",
          content: `Analyze this coding session and generate a narrative story:

${JSON.stringify(context, null, 2)}`,
        },
      ],
      llmConfig,
    );

    const parsed = JSON.parse(response.content);

    return {
      title: parsed.title || `Session: ${context.project || sessionId.slice(0, 8)}`,
      summary: parsed.summary || "Unable to generate summary.",
      highlights: parsed.highlights || [],
      recommendations: parsed.recommendations || [],
      trends: parsed.trends || [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Session story LLM error:", error);
    return buildFallbackResult(sessionId, prompts);
  }
}
