import { PromptDetail } from "@/components/prompt-detail";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";

// Force dynamic rendering - don't pre-render at build time
export const dynamic = "force-dynamic";

/**
 * Get current user from session cookie
 */
async function getCurrentUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  return parseSessionToken(sessionToken);
}

async function getPrompt(id: string, userId: string | null) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  // Build query with user ownership check
  const whereCondition = userId
    ? and(eq(schema.prompts.id, id), eq(schema.prompts.userId, userId))
    : eq(schema.prompts.id, id);

  const result = await db
    .select()
    .from(schema.prompts)
    .where(whereCondition)
    .limit(1);

  await client.end();

  return result[0] ?? null;
}

interface PromptDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PromptDetailPage({ params }: PromptDetailPageProps) {
  const resolvedParams = await params;

  // Get current user from session
  const user = await getCurrentUser();
  const userId = user?.userId ?? null;

  const prompt = await getPrompt(resolvedParams.id, userId);

  if (!prompt) {
    notFound();
  }

  const db = drizzle(postgres(process.env.DATABASE_URL!), { schema });
  const promptWithTags = await db.query.prompts.findFirst({
    where: eq(schema.prompts.id, prompt.id),
    with: {
      promptTags: {
        with: {
          tag: true,
        },
      },
    },
  });

  const tags = promptWithTags?.promptTags.map(pt => pt.tag) ?? [];

  // Parse the prompt to create a simple message structure
  const messages = [
    {
      role: "user" as const,
      content: prompt.promptText,
      timestamp: prompt.timestamp,
      tokens: prompt.tokenEstimate ?? Math.ceil(prompt.promptLength / 4),
    },
  ];

  if (prompt.responseText) {
    messages.push({
      role: "assistant" as const,
      content: prompt.responseText,
      timestamp: prompt.updatedAt ?? prompt.timestamp,
      tokens: prompt.tokenEstimateResponse ?? Math.ceil((prompt.responseLength ?? 0) / 4),
    });
  }

  return (
    <PromptDetail
      id={prompt.id}
      sessionId={prompt.minioKey}
      timestamp={prompt.timestamp}
      projectName={prompt.projectName}
      workingDirectory={prompt.workingDirectory}
      messages={messages}
      inputTokens={prompt.tokenEstimate ?? Math.ceil(prompt.promptLength / 4)}
      outputTokens={prompt.tokenEstimateResponse ?? 0}
      promptType={prompt.promptType}
      tags={tags}
    />
  );
}
