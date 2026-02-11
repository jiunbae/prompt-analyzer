import type { ProcessorInput, InsightResult } from "../types";
import { getLLMConfig, callLLM } from "../llm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { sql, eq, and, isNull } from "drizzle-orm";

const VALID_TOPICS = [
  "debugging",
  "feature",
  "refactoring",
  "devops",
  "testing",
  "documentation",
  "architecture",
  "performance",
  "security",
  "ui",
  "data",
  "config",
  "other",
] as const;

type TopicTag = (typeof VALID_TOPICS)[number];

const BATCH_SIZE = 10;

interface LLMScoreResult {
  id: string;
  quality_score: number;
  topic_tags: string[];
  reasoning: string;
}

// ── Heuristic fallback (no LLM) ──────────────────────────────────

export function computeHeuristicScore(
  promptText: string,
  opts?: { hasContext?: boolean },
): { qualityScore: number; topicTags: TopicTag[] } {
  let score = 50;

  if (promptText.length > 100) score += 10;
  if (promptText.length < 20) score -= 10;

  // Contains question marks or clear instruction words
  if (/[?]/.test(promptText) || /\b(please|should|could|create|implement|fix|update|add|remove|change|write)\b/i.test(promptText)) {
    score += 10;
  }

  // Mentions specific files or functions
  if (/\.[a-z]{1,5}\b/.test(promptText) || /\b\w+\(/.test(promptText) || /\/[\w.-]+/.test(promptText)) {
    score += 10;
  }

  // Has context (project/cwd set)
  if (opts?.hasContext) {
    score += 5;
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  return { qualityScore: score, topicTags: ["other"] };
}

// ── LLM batch scoring ────────────────────────────────────────────

function buildLLMPrompt(
  prompts: Array<{ id: string; text: string }>,
): string {
  const promptList = prompts
    .map((p) => `- ID: ${p.id}\n  Text: ${p.text.slice(0, 500)}`)
    .join("\n\n");

  return `You are a prompt quality analyst. Evaluate each of the following user prompts sent to an AI coding assistant.

For each prompt, provide:
1. quality_score (0-100) based on:
   - Clarity: Is the request clear and unambiguous?
   - Context: Does it provide enough background?
   - Specificity: Is it specific enough to act on?
   - Completeness: Does it include all necessary information?

2. topic_tags: one or more tags from this set: "debugging", "feature", "refactoring", "devops", "testing", "documentation", "architecture", "performance", "security", "ui", "data", "config", "other"

3. reasoning: A brief explanation of the score.

Prompts to evaluate:

${promptList}

Respond with ONLY valid JSON in this exact format, no markdown fences:
{
  "scores": [
    {
      "id": "prompt-uuid",
      "quality_score": 75,
      "topic_tags": ["debugging", "refactoring"],
      "reasoning": "Clear problem statement with context..."
    }
  ]
}`;
}

function parseLLMResponse(
  raw: string,
  promptIds: string[],
): LLMScoreResult[] {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();

  let parsed: { scores: LLMScoreResult[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("Failed to parse LLM response for prompt quality:", cleaned.slice(0, 200));
    return [];
  }

  if (!Array.isArray(parsed.scores)) {
    return [];
  }

  const validIds = new Set(promptIds);

  return parsed.scores
    .filter((s) => validIds.has(s.id))
    .map((s) => ({
      id: s.id,
      quality_score: Math.max(0, Math.min(100, Math.round(Number(s.quality_score) || 0))),
      topic_tags: (Array.isArray(s.topic_tags) ? s.topic_tags : [])
        .map((t: string) => t.toLowerCase().trim())
        .filter((t: string) => (VALID_TOPICS as readonly string[]).includes(t)),
      reasoning: typeof s.reasoning === "string" ? s.reasoning : "",
    }))
    .map((s) => ({
      ...s,
      topic_tags: s.topic_tags.length > 0 ? s.topic_tags : ["other"],
    }));
}

// ── Main handler ─────────────────────────────────────────────────

export async function handler(input: ProcessorInput): Promise<InsightResult> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // Fetch unenriched prompts for the user
    const unenriched = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        projectName: schema.prompts.projectName,
        workingDirectory: schema.prompts.workingDirectory,
      })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, input.userId),
          isNull(schema.prompts.enrichedAt),
          eq(schema.prompts.promptType, "user_input"),
        ),
      )
      .limit(200);

    if (unenriched.length === 0) {
      // Get existing stats to report
      const existingStats = await getQualityStats(db, input.userId);
      return {
        title: "Prompt Quality Enrichment",
        summary: `All prompts are already enriched. ${existingStats.totalEnriched} prompts scored with average quality ${existingStats.averageScore}.`,
        highlights: [
          { label: "Total Enriched", value: existingStats.totalEnriched },
          { label: "Average Quality", value: existingStats.averageScore },
        ],
        confidence: 1,
        generatedAt: new Date().toISOString(),
      };
    }

    const llmConfig = getLLMConfig();
    let totalScored = 0;
    let totalQuality = 0;
    const topicCounts: Record<string, number> = {};

    // Process in batches
    for (let i = 0; i < unenriched.length; i += BATCH_SIZE) {
      const batch = unenriched.slice(i, i + BATCH_SIZE);

      if (llmConfig) {
        // LLM-powered scoring
        const promptsForLLM = batch.map((p) => ({
          id: p.id,
          text: p.promptText,
        }));

        try {
          const response = await callLLM(
            [
              {
                role: "system",
                content: "You are a prompt quality analyst. Always respond with valid JSON only.",
              },
              {
                role: "user",
                content: buildLLMPrompt(promptsForLLM),
              },
            ],
            llmConfig,
          );

          const scores = parseLLMResponse(
            response.content,
            batch.map((p) => p.id),
          );

          // Update database with LLM scores
          for (const score of scores) {
            await db
              .update(schema.prompts)
              .set({
                qualityScore: score.quality_score,
                topicTags: score.topic_tags,
                enrichedAt: new Date(),
              })
              .where(eq(schema.prompts.id, score.id));

            totalScored++;
            totalQuality += score.quality_score;
            for (const tag of score.topic_tags) {
              topicCounts[tag] = (topicCounts[tag] || 0) + 1;
            }
          }

          // For any prompts the LLM skipped, fall back to heuristic
          const scoredIds = new Set(scores.map((s) => s.id));
          for (const prompt of batch) {
            if (!scoredIds.has(prompt.id)) {
              const heuristic = computeHeuristicScore(prompt.promptText, {
                hasContext: !!(prompt.projectName || prompt.workingDirectory),
              });
              await db
                .update(schema.prompts)
                .set({
                  qualityScore: heuristic.qualityScore,
                  topicTags: heuristic.topicTags,
                  enrichedAt: new Date(),
                })
                .where(eq(schema.prompts.id, prompt.id));

              totalScored++;
              totalQuality += heuristic.qualityScore;
              for (const tag of heuristic.topicTags) {
                topicCounts[tag] = (topicCounts[tag] || 0) + 1;
              }
            }
          }
        } catch (llmError) {
          // LLM call failed, fall back to heuristic for entire batch
          console.error("LLM call failed, using heuristic fallback:", llmError);
          for (const prompt of batch) {
            const heuristic = computeHeuristicScore(prompt.promptText, {
              hasContext: !!(prompt.projectName || prompt.workingDirectory),
            });
            await db
              .update(schema.prompts)
              .set({
                qualityScore: heuristic.qualityScore,
                topicTags: heuristic.topicTags,
                enrichedAt: new Date(),
              })
              .where(eq(schema.prompts.id, prompt.id));

            totalScored++;
            totalQuality += heuristic.qualityScore;
            for (const tag of heuristic.topicTags) {
              topicCounts[tag] = (topicCounts[tag] || 0) + 1;
            }
          }
        }
      } else {
        // No LLM configured — heuristic only
        for (const prompt of batch) {
          const heuristic = computeHeuristicScore(prompt.promptText, {
            hasContext: !!(prompt.projectName || prompt.workingDirectory),
          });
          await db
            .update(schema.prompts)
            .set({
              qualityScore: heuristic.qualityScore,
              topicTags: heuristic.topicTags,
              enrichedAt: new Date(),
            })
            .where(eq(schema.prompts.id, prompt.id));

          totalScored++;
          totalQuality += heuristic.qualityScore;
          for (const tag of heuristic.topicTags) {
            topicCounts[tag] = (topicCounts[tag] || 0) + 1;
          }
        }
      }
    }

    const averageQuality = totalScored > 0 ? Math.round(totalQuality / totalScored) : 0;

    // Sort topics by count descending
    const topTopics = Object.entries(topicCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag, count]) => `${tag} (${count})`);

    const recommendations: string[] = [];
    if (averageQuality < 40) {
      recommendations.push("Consider adding more context and specificity to your prompts.");
      recommendations.push("Try including file names or function references for more precise results.");
    } else if (averageQuality < 70) {
      recommendations.push("Your prompts are reasonable but could benefit from more background context.");
    } else {
      recommendations.push("Your prompt quality is strong! Keep providing clear, specific requests.");
    }

    return {
      title: "Prompt Quality Enrichment",
      summary: `Scored ${totalScored} prompts with an average quality of ${averageQuality}/100. Top topics: ${topTopics.join(", ") || "none"}.`,
      highlights: [
        { label: "Prompts Scored", value: totalScored },
        { label: "Average Quality", value: `${averageQuality}/100` },
        { label: "Remaining Unenriched", value: Math.max(0, unenriched.length - totalScored) },
      ],
      trends: [
        {
          metric: "quality",
          direction: averageQuality >= 60 ? "up" : averageQuality >= 40 ? "stable" : "down",
          magnitude: averageQuality,
          explanation: `Average quality score is ${averageQuality}/100`,
        },
      ],
      recommendations,
      confidence: llmConfig ? 0.85 : 0.5,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    await client.end();
  }
}

// ── Helper to get aggregate stats ────────────────────────────────

async function getQualityStats(
  db: ReturnType<typeof drizzle<typeof schema>>,
  userId: string,
): Promise<{ totalEnriched: number; averageScore: number }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
      avg: sql<number>`coalesce(avg(quality_score), 0)`,
    })
    .from(schema.prompts)
    .where(
      and(
        eq(schema.prompts.userId, userId),
        sql`${schema.prompts.enrichedAt} IS NOT NULL`,
      ),
    );

  return {
    totalEnriched: Number(row?.count ?? 0),
    averageScore: Math.round(Number(row?.avg ?? 0)),
  };
}
