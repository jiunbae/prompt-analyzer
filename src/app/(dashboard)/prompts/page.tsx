import { PromptList } from "@/components/prompt-list";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { desc, sql, and, gte, lte, eq, ilike } from "drizzle-orm";
import { SearchFilters } from "@/components/search-filters";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";

// Force dynamic rendering - don't pre-render at build time
export const dynamic = "force-dynamic";

interface SearchParams {
  page?: string;
  search?: string;
  project?: string;
  type?: string;
  from?: string;
  to?: string;
}

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

async function getPrompts(
  params: SearchParams,
  userId: string | null,
  pageSize: number = 20
) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return { items: [], totalCount: 0, projects: [] };
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  const page = parseInt(params.page ?? "1", 10);
  const offset = (page - 1) * pageSize;

  // Build conditions - always filter by user if logged in
  const conditions = [];

  // User filter - only show prompts belonging to the current user
  if (userId) {
    conditions.push(eq(schema.prompts.userId, userId));
  }

  if (params.search) {
    conditions.push(ilike(schema.prompts.promptText, `%${params.search}%`));
  }

  if (params.project) {
    conditions.push(eq(schema.prompts.projectName, params.project));
  }

  if (params.type) {
    conditions.push(eq(schema.prompts.promptType, params.type));
  }

  if (params.from) {
    conditions.push(gte(schema.prompts.timestamp, new Date(params.from)));
  }

  if (params.to) {
    const toDate = new Date(params.to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(schema.prompts.timestamp, toDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build user-scoped where clause for projects query
  const userCondition = userId
    ? and(sql`project_name is not null`, eq(schema.prompts.userId, userId))
    : sql`project_name is not null`;

  const [items, countResult, projectsResult] = await Promise.all([
    db
      .select({
        id: schema.prompts.id,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        promptType: schema.prompts.promptType,
        promptLength: schema.prompts.promptLength,
        tokenEstimate: schema.prompts.tokenEstimate,
        promptText: schema.prompts.promptText,
        workingDirectory: schema.prompts.workingDirectory,
      })
      .from(schema.prompts)
      .where(whereClause)
      .orderBy(desc(schema.prompts.timestamp))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(schema.prompts).where(whereClause),
    db
      .select({ name: schema.prompts.projectName, count: sql<number>`count(*)` })
      .from(schema.prompts)
      .where(userCondition)
      .groupBy(schema.prompts.projectName)
      .orderBy(desc(sql`count(*)`)),
  ]);

  await client.end();

  return {
    items: items.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      projectName: item.projectName,
      promptType: (item.promptType as "user_input" | "task_notification" | "system") || "user_input",
      tokenCount: item.tokenEstimate ?? Math.ceil(item.promptLength / 4),
      preview: item.promptText.slice(0, 200) + (item.promptText.length > 200 ? "..." : ""),
      tags: [],
    })),
    totalCount: Number(countResult[0]?.count ?? 0),
    projects: projectsResult.map((p) => ({ name: p.name ?? "", count: Number(p.count) })),
  };
}

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const pageSize = 20;

  // Get current user from session
  const user = await getCurrentUser();
  const userId = user?.userId ?? null;

  const { items, totalCount, projects } = await getPrompts(params, userId, pageSize);
  const currentPage = parseInt(params.page ?? "1", 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Prompts</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Browse and search your Claude Code conversations ({totalCount} total)
        </p>
      </div>

      <SearchFilters
        projects={projects}
        currentSearch={params.search}
        currentProject={params.project}
        currentType={params.type}
        currentFrom={params.from}
        currentTo={params.to}
      />

      <PromptList
        prompts={items}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
      />
    </div>
  );
}
