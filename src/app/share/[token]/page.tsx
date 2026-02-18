import { notFound } from "next/navigation";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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

async function getSharedPrompt(token: string): Promise<SharedPromptData | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // Find the shared prompt
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

    if (!shared) {
      await client.end();
      return null;
    }

    // Check expiry
    if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) {
      await client.end();
      return null;
    }

    // Fetch the prompt
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

    if (!prompt) {
      await client.end();
      return null;
    }

    // Increment view count
    await db
      .update(schema.sharedPrompts)
      .set({ viewCount: sql`${schema.sharedPrompts.viewCount} + 1` })
      .where(eq(schema.sharedPrompts.id, shared.id));

    await client.end();

    return {
      ...prompt,
      sharedAt: shared.createdAt,
    };
  } catch (error) {
    console.error("Error fetching shared prompt:", error);
    await client.end();
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const prompt = await getSharedPrompt(token);

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
  const prompt = await getSharedPrompt(token);

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
