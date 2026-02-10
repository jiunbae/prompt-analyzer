import { PromptList } from "@/components/prompt-list";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { desc, sql, and, gte, lte, eq } from "drizzle-orm";
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
  tag?: string;
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
    conditions.push(sql`${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${params.search})`);
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

  if (params.tag) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${schema.promptTags} pt
      JOIN ${schema.tags} t ON pt.tag_id = t.id
      WHERE pt.prompt_id = ${schema.prompts.id} AND t.name = ${params.tag}
    )`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  try {
    // Build user-scoped where clause for projects query
    const userCondition = userId
      ? and(sql`project_name is not null`, eq(schema.prompts.userId, userId))
      : sql`project_name is not null`;

    const [items, countResult, projectsResult, allTags] = await Promise.all([
      db.query.prompts.findMany({
        where: whereClause,
        orderBy: [desc(schema.prompts.timestamp)],
        limit: pageSize,
        offset: offset,
        with: {
          promptTags: {
            with: {
              tag: true,
            },
          },
        },
      }),
      db.select({ count: sql<number>`count(*)` }).from(schema.prompts).where(whereClause),
      db
        .select({ name: schema.prompts.projectName, count: sql<number>`count(*)` })
        .from(schema.prompts)
        .where(userCondition)
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`)),
      db.select().from(schema.tags).orderBy(schema.tags.name),
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
        tags: item.promptTags.map((pt) => pt.tag),
      })),
      totalCount: Number(countResult[0]?.count ?? 0),
      projects: projectsResult.map((p) => ({ name: p.name ?? "", count: Number(p.count) })),
      allTags,
    };
  } catch (error) {
    console.error("Database query error in getPrompts:", error);
    await client.end();
    return { items: [], totalCount: 0, projects: [], allTags: [], error: true };
  }
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

  const { items, totalCount, projects, allTags, error } = await getPrompts(params, userId, pageSize);

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Prompts</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse and search your prompt history</p>
        </div>
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          <p className="font-medium">Failed to load prompts</p>
          <p className="mt-1 text-red-400/80">A database error occurred. Please try again later.</p>
        </div>
      </div>
    );
  }

  const currentPage = parseInt(params.page ?? "1", 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Prompts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and search your prompt history ({totalCount} total)
        </p>
      </div>

      <SearchFilters
        projects={projects}
        tags={allTags}
        currentSearch={params.search}
        currentProject={params.project}
        currentType={params.type}
        currentFrom={params.from}
        currentTo={params.to}
        currentTag={params.tag}
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
