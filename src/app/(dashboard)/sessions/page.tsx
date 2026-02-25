import { SessionCard } from "@/components/session-card";
import { SessionFilters } from "@/components/session-filters";
import { getSessionUser } from "@/lib/with-auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface SearchParams {
  page?: string;
  search?: string;
  searchMode?: string;
  project?: string;
  source?: string;
  device?: string;
  workspace?: string;
  from?: string;
  to?: string;
}

const getCurrentUser = getSessionUser;

interface SessionRow {
  session_id: string;
  started_at: string;
  ended_at: string;
  prompt_count: number;
  response_count: number;
  project_name: string | null;
  source: string | null;
  device_name: string | null;
  first_prompt: string;
  total_tokens: number;
}

async function getSessions(params: SearchParams, userId: string) {

  const page = parseInt(params.page ?? "1", 10);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(schema.prompts.userId, userId),
    sql`${schema.prompts.sessionId} IS NOT NULL`,
  ];

  if (params.project) conditions.push(eq(schema.prompts.projectName, params.project));
  if (params.source) conditions.push(eq(schema.prompts.source, params.source));
  if (params.device) conditions.push(eq(schema.prompts.deviceName, params.device));
  if (params.workspace) conditions.push(eq(schema.prompts.workingDirectory, params.workspace));
  if (params.from) conditions.push(gte(schema.prompts.timestamp, new Date(params.from)));
  if (params.to) {
    const toDate = new Date(params.to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(schema.prompts.timestamp, toDate));
  }
  if (params.search) {
    const searchMode = params.searchMode || "keyword";
    if (searchMode === "semantic") {
      conditions.push(
        sql`${schema.prompts.promptText} % ${params.search} AND similarity(${schema.prompts.promptText}, ${params.search}) > 0.1`
      );
    } else if (searchMode === "hybrid") {
      conditions.push(
        sql`(${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${params.search}) OR (${schema.prompts.promptText} % ${params.search} AND similarity(${schema.prompts.promptText}, ${params.search}) > 0.1))`
      );
    } else {
      conditions.push(
        sql`${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${params.search})`
      );
    }
  }

  const whereClause = and(...conditions);

  // Base conditions for filter options (user's sessions only)
  const baseConditions = and(
    eq(schema.prompts.userId, userId),
    sql`${schema.prompts.sessionId} IS NOT NULL`,
  );

  try {
    const [sessionsResult, countResult, projectsResult, sourcesResult, devicesResult, workspacesResult] = await Promise.all([
      db.execute(sql`
        SELECT
          ${schema.prompts.sessionId} as session_id,
          MIN(${schema.prompts.timestamp}) as started_at,
          MAX(${schema.prompts.timestamp}) as ended_at,
          COUNT(*)::int as prompt_count,
          COUNT(${schema.prompts.responseText})::int as response_count,
          (array_agg(${schema.prompts.projectName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as project_name,
          (array_agg(${schema.prompts.source} ORDER BY ${schema.prompts.timestamp} ASC))[1] as source,
          (array_agg(${schema.prompts.deviceName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as device_name,
          LEFT((array_agg(${schema.prompts.promptText} ORDER BY ${schema.prompts.timestamp} ASC))[1], 200) as first_prompt,
          SUM(COALESCE(${schema.prompts.tokenEstimate}, 0) + COALESCE(${schema.prompts.tokenEstimateResponse}, 0))::int as total_tokens
        FROM ${schema.prompts}
        WHERE ${whereClause}
        GROUP BY ${schema.prompts.sessionId}
        ORDER BY MAX(${schema.prompts.timestamp}) DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(DISTINCT ${schema.prompts.sessionId})::int as count
        FROM ${schema.prompts}
        WHERE ${whereClause}
      `),
      db
        .select({ name: schema.prompts.projectName, count: sql<number>`count(distinct ${schema.prompts.sessionId})` })
        .from(schema.prompts)
        .where(and(baseConditions, sql`${schema.prompts.projectName} IS NOT NULL`))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(distinct ${schema.prompts.sessionId})`)),
      db
        .select({ name: schema.prompts.source, count: sql<number>`count(distinct ${schema.prompts.sessionId})` })
        .from(schema.prompts)
        .where(and(baseConditions, sql`${schema.prompts.source} IS NOT NULL`))
        .groupBy(schema.prompts.source)
        .orderBy(desc(sql`count(distinct ${schema.prompts.sessionId})`)),
      db
        .select({ name: schema.prompts.deviceName, count: sql<number>`count(distinct ${schema.prompts.sessionId})` })
        .from(schema.prompts)
        .where(and(baseConditions, sql`${schema.prompts.deviceName} IS NOT NULL`))
        .groupBy(schema.prompts.deviceName)
        .orderBy(desc(sql`count(distinct ${schema.prompts.sessionId})`)),
      db
        .select({ name: schema.prompts.workingDirectory, count: sql<number>`count(distinct ${schema.prompts.sessionId})` })
        .from(schema.prompts)
        .where(and(baseConditions, sql`${schema.prompts.workingDirectory} IS NOT NULL AND ${schema.prompts.workingDirectory} != 'unknown'`))
        .groupBy(schema.prompts.workingDirectory)
        .orderBy(desc(sql`count(distinct ${schema.prompts.sessionId})`))
        .limit(50),
    ]);



    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sRows = (sessionsResult as any).rows ?? sessionsResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cRows = (countResult as any).rows ?? countResult;
    return {
      sessions: sRows as SessionRow[],
      totalCount: Number((cRows[0] as Record<string, unknown>)?.count ?? 0),
      projects: projectsResult.map((p) => ({ name: p.name ?? "", count: Number(p.count) })),
      sources: sourcesResult.map((s) => ({ name: s.name ?? "", count: Number(s.count) })),
      devices: devicesResult.map((d) => ({ name: d.name ?? "", count: Number(d.count) })),
      workspaces: workspacesResult.map((w) => ({ name: w.name ?? "", count: Number(w.count) })),
    };
  } catch (error) {
    console.error("Sessions query error:", error);

    return { sessions: [], totalCount: 0, projects: [], sources: [], devices: [], workspaces: [], error: true };
  }
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;

  const { sessions, totalCount, projects, sources, devices, workspaces, error } = await getSessions(params, user.userId);
  const currentPage = parseInt(params.page ?? "1", 10);
  const pageSize = 20;
  const totalPages = Math.ceil(totalCount / pageSize);

  const buildPageUrl = (page: number) => {
    const p = new URLSearchParams();
    if (page > 1) p.set("page", String(page));
    if (params.search) p.set("search", params.search);
    if (params.searchMode) p.set("searchMode", params.searchMode);
    if (params.project) p.set("project", params.project);
    if (params.source) p.set("source", params.source);
    if (params.device) p.set("device", params.device);
    if (params.workspace) p.set("workspace", params.workspace);
    if (params.from) p.set("from", params.from);
    if (params.to) p.set("to", params.to);
    const qs = p.toString();
    return `/sessions${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse your Claude Code sessions ({totalCount} total)
        </p>
      </div>

      <SessionFilters
        projects={projects}
        sources={sources}
        devices={devices}
        workspaces={workspaces}
        currentSearch={params.search}
        currentSearchMode={params.searchMode}
        currentProject={params.project}
        currentSource={params.source}
        currentDevice={params.device}
        currentWorkspace={params.workspace}
        currentFrom={params.from}
        currentTo={params.to}
      />

      {error ? (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          <p className="font-medium">Failed to load sessions</p>
          <p className="mt-1 text-red-400/80">A database error occurred. Please try again later.</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No sessions found.</p>
          <p className="text-sm mt-1">Sessions are created when prompts share a session ID.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.session_id}
              sessionId={s.session_id}
              firstPrompt={s.first_prompt}
              startedAt={String(s.started_at)}
              endedAt={String(s.ended_at)}
              promptCount={s.prompt_count}
              responseCount={s.response_count}
              projectName={s.project_name}
              source={s.source}
              deviceName={s.device_name}
              totalTokens={s.total_tokens}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {currentPage > 1 && (
            <Link
              href={buildPageUrl(currentPage - 1)}
              className="px-3 py-2 text-sm rounded-lg border border-border text-secondary-foreground hover:bg-accent"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages && (
            <Link
              href={buildPageUrl(currentPage + 1)}
              className="px-3 py-2 text-sm rounded-lg border border-border text-secondary-foreground hover:bg-accent"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
