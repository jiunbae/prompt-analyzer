import { PromptDetail } from "@/components/prompt-detail";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { computeSimilarity } from "@/lib/prompt-diff";
import Link from "next/link";

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
  // Build query with user ownership check
  const whereCondition = userId
    ? and(eq(schema.prompts.id, id), eq(schema.prompts.userId, userId))
    : eq(schema.prompts.id, id);

  const result = await db
    .select()
    .from(schema.prompts)
    .where(whereCondition)
    .limit(1);

  return result[0] ?? null;
}

interface SimilarPrompt {
  id: string;
  timestamp: string;
  projectName: string | null;
  similarity: number;
  firstLine: string;
}

async function getSimilarPrompts(
  sourcePrompt: { id: string; promptText: string; userId: string | null },
  isAdmin: boolean
): Promise<SimilarPrompt[]> {
  try {
    const words = sourcePrompt.promptText
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 15);

    if (words.length === 0) return [];

    const searchText = words.join(" ");

    const userFilter = isAdmin
      ? sql`TRUE`
      : sql`${schema.prompts.userId} = ${sourcePrompt.userId}`;

    const candidates = await db
      .select({
        id: schema.prompts.id,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        promptText: schema.prompts.promptText,
      })
      .from(schema.prompts)
      .where(
        and(
          ne(schema.prompts.id, sourcePrompt.id),
          sql`${schema.prompts.searchVector} @@ plainto_tsquery('english', ${searchText})`,
          sql`${userFilter}`
        )
      )
      .orderBy(
        sql`ts_rank(${schema.prompts.searchVector}, plainto_tsquery('english', ${searchText})) DESC`
      )
      .limit(15);

    const ranked = candidates
      .map((c) => ({
        id: c.id,
        timestamp: c.timestamp.toISOString(),
        projectName: c.projectName,
        similarity: computeSimilarity(sourcePrompt.promptText, c.promptText),
        firstLine: c.promptText.split("\n")[0].slice(0, 120),
      }))
      .filter((c) => c.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    return ranked;
  } catch {
    return [];
  }
}

interface PromptDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PromptDetailPage({ params }: PromptDetailPageProps) {
  const resolvedParams = await params;

  // Get current user from session — admins can view any prompt
  const user = await getCurrentUser();
  const userId = user?.isAdmin ? null : (user?.userId ?? null);

  const prompt = await getPrompt(resolvedParams.id, userId);

  if (!prompt) {
    notFound();
  }

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
  const messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
    tokens: number;
  }> = [
    {
      role: "user",
      content: prompt.promptText,
      timestamp: prompt.timestamp,
      tokens: prompt.tokenEstimate ?? Math.ceil(prompt.promptLength / 4),
    },
  ];

  if (prompt.responseText) {
    messages.push({
      role: "assistant",
      content: prompt.responseText,
      timestamp: prompt.updatedAt ?? prompt.timestamp,
      tokens: prompt.tokenEstimateResponse ?? Math.ceil((prompt.responseLength ?? 0) / 4),
    });
  }

  const similarPrompts = await getSimilarPrompts(
    { id: prompt.id, promptText: prompt.promptText, userId: prompt.userId },
    user?.isAdmin ?? false
  );

  return (
    <div className="space-y-8">
      <PromptDetail
        id={prompt.id}
        sessionId={prompt.sessionId ?? undefined}
        timestamp={prompt.timestamp}
        projectName={prompt.projectName}
        workingDirectory={prompt.workingDirectory}
        messages={messages}
        inputTokens={prompt.tokenEstimate ?? Math.ceil(prompt.promptLength / 4)}
        outputTokens={prompt.tokenEstimateResponse ?? 0}
        promptType={prompt.promptType}
        tags={tags}
      />

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Similar Prompts</h2>
          <p className="text-sm text-muted-foreground">
            Find related prompts and compare their wording.
          </p>
        </div>

        {similarPrompts.length === 0 ? (
          <div className="px-6 py-5 text-sm text-muted-foreground">
            No similar prompts found for this prompt yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {similarPrompts.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.firstLine || "Untitled prompt"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(item.similarity * 100)}% similar
                  </p>
                </div>

                <Link
                  href={`/compare?a=${prompt.id}&b=${item.id}`}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Compare
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
