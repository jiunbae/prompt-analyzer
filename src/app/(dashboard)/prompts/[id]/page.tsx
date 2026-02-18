import { PromptDetail } from "@/components/prompt-detail";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
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

interface SimilarPrompt {
  id: string;
  timestamp: string;
  projectName: string | null;
  similarity: number;
  firstLine: string;
}

async function getSimilarPrompts(id: string): Promise<SimilarPrompt[]> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? "http";
  const baseUrl = host ? `${protocol}://${host}` : process.env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    return [];
  }

  const cookieHeader = (await cookies()).toString();
  const response = await fetch(
    `${baseUrl}/api/prompts/similar?id=${encodeURIComponent(id)}&limit=5`,
    {
      method: "GET",
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { prompts?: SimilarPrompt[] };
  return Array.isArray(payload.prompts) ? payload.prompts : [];
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

  const similarPrompts = await getSimilarPrompts(prompt.id);

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
