import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
    if (!session.isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || null;
    const search = searchParams.get("search") || null;
    const project = searchParams.get("project") || null;
    const source = searchParams.get("source") || null;
    const device = searchParams.get("device") || null;
    const workspace = searchParams.get("workspace") || null;
    const from = searchParams.get("from") || null;
    const to = searchParams.get("to") || null;
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = await import("postgres");
    const schema = await import("@/db/schema");
    const { eq, and, gte, lte, sql, desc } = await import("drizzle-orm");

    const client = postgres.default(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
      const conditions = [
        sql`${schema.prompts.sessionId} IS NOT NULL`,
      ];

      if (userId) conditions.push(eq(schema.prompts.userId, userId));
      if (search) conditions.push(sql`${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${search})`);
      if (project) conditions.push(eq(schema.prompts.projectName, project));
      if (source) conditions.push(eq(schema.prompts.source, source));
      if (device) conditions.push(eq(schema.prompts.deviceName, device));
      if (workspace) conditions.push(eq(schema.prompts.workingDirectory, workspace));
      if (from) conditions.push(gte(schema.prompts.timestamp, new Date(from)));
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(schema.prompts.timestamp, toDate));
      }

      const whereClause = and(...conditions);
      const baseConditions = and(
        sql`${schema.prompts.sessionId} IS NOT NULL`,
      );

      const [sessionsResult, countResult, usersResult, projectsResult, sourcesResult, devicesResult, workspacesResult] = await Promise.all([
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
            (array_agg(${schema.prompts.userId} ORDER BY ${schema.prompts.timestamp} ASC))[1] as user_id,
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
          .select({
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
          })
          .from(schema.users)
          .orderBy(schema.users.email),
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
      const sRows = ((sessionsResult as any).rows ?? sessionsResult) as Record<string, unknown>[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cRows = ((countResult as any).rows ?? countResult) as Record<string, unknown>[];

      return NextResponse.json({
        sessions: sRows.map((row) => ({
          sessionId: row.session_id,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          promptCount: row.prompt_count,
          responseCount: row.response_count,
          projectName: row.project_name,
          source: row.source,
          deviceName: row.device_name,
          userId: row.user_id,
          firstPrompt: row.first_prompt,
          totalTokens: row.total_tokens,
        })),
        totalCount: Number(cRows[0]?.count ?? 0),
        users: usersResult,
        projects: projectsResult.map((p) => ({ name: p.name ?? "", count: Number(p.count) })),
        sources: sourcesResult.map((s) => ({ name: s.name ?? "", count: Number(s.count) })),
        devices: devicesResult.map((d) => ({ name: d.name ?? "", count: Number(d.count) })),
        workspaces: workspacesResult.map((w) => ({ name: w.name ?? "", count: Number(w.count) })),
      });
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("Admin sessions API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
