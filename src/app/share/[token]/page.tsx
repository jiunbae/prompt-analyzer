import { notFound } from "next/navigation";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { SharedPromptView } from "@/components/shared-prompt-view";

export const dynamic = "force-dynamic";

interface SharedPromptData {
  id: string;
  promptText: string;
  responseText: string | null;
  timestamp: Date;
  projectName: string | null;
  source: string | null;
  promptType: string | null;
  qualityScore: number | null;
  tokenEstimate: number | null;
  tokenEstimateResponse: number | null;
  sharedAt: Date | null;
}

/**
 * Read-only fetch: returns shared prompt data WITHOUT incrementing view count.
 * Used by generateMetadata so crawlers / metadata prefetches don't inflate counts.
 */
async function getSharedPromptReadOnly(token: string): Promise<SharedPromptData | null> {
  try {
    const [shared] = await db
      .select()
      .from(schema.sharedPrompts)
      .where(
        and(
          eq(schema.sharedPrompts.shareToken, token),
          eq(schema.sharedPrompts.isActive, true)
        )
      )
      .limit(1);

    if (!shared) return null;
    if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) return null;

    const [prompt] = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        responseText: schema.prompts.responseText,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        source: schema.prompts.source,
        promptType: schema.prompts.promptType,
        qualityScore: schema.prompts.qualityScore,
        tokenEstimate: schema.prompts.tokenEstimate,
        tokenEstimateResponse: schema.prompts.tokenEstimateResponse,
      })
      .from(schema.prompts)
      .where(eq(schema.prompts.id, shared.promptId))
      .limit(1);

    if (!prompt) return null;

    return {
      ...prompt,
      sharedAt: shared.createdAt,
    };
  } catch (error) {
    logger.error({ err: error }, "Error fetching shared prompt (read-only)");
    return null;
  }
}

/**
 * Fetch shared prompt AND increment view count.
 * Used only on actual page render.
 */
async function getSharedPromptAndIncrement(token: string): Promise<SharedPromptData | null> {
  try {
    const [shared] = await db
      .select()
      .from(schema.sharedPrompts)
      .where(
        and(
          eq(schema.sharedPrompts.shareToken, token),
          eq(schema.sharedPrompts.isActive, true)
        )
      )
      .limit(1);

    if (!shared) return null;
    if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) return null;

    const [prompt] = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        responseText: schema.prompts.responseText,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        source: schema.prompts.source,
        promptType: schema.prompts.promptType,
        qualityScore: schema.prompts.qualityScore,
        tokenEstimate: schema.prompts.tokenEstimate,
        tokenEstimateResponse: schema.prompts.tokenEstimateResponse,
      })
      .from(schema.prompts)
      .where(eq(schema.prompts.id, shared.promptId))
      .limit(1);

    if (!prompt) return null;

    // Increment view count only here (page render)
    await db
      .update(schema.sharedPrompts)
      .set({ viewCount: sql`${schema.sharedPrompts.viewCount} + 1` })
      .where(eq(schema.sharedPrompts.id, shared.id));

    return {
      ...prompt,
      sharedAt: shared.createdAt,
    };
  } catch (error) {
    logger.error({ err: error }, "Error fetching shared prompt");
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const prompt = await getSharedPromptReadOnly(token);

  if (!prompt) {
    return { title: "Shared Prompt - Oh My Prompt" };
  }

  const preview = prompt.promptText.slice(0, 160);
  return {
    title: `Shared Prompt${prompt.projectName ? ` - ${prompt.projectName}` : ""} | Oh My Prompt`,
    description: preview,
  };
}

export default async function SharedPromptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const prompt = await getSharedPromptAndIncrement(token);

  if (!prompt) {
    notFound();
  }

  return (
    <SharedPromptView
      promptText={prompt.promptText}
      responseText={prompt.responseText}
      timestamp={prompt.timestamp.toISOString()}
      projectName={prompt.projectName}
      source={prompt.source}
      promptType={prompt.promptType}
      qualityScore={prompt.qualityScore}
      tokenEstimate={prompt.tokenEstimate}
      tokenEstimateResponse={prompt.tokenEstimateResponse}
    />
  );
}
