import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || null;
    const search = searchParams.get("search") || null;
    const project = searchParams.get("project") || null;
    const type = searchParams.get("type") || null;
    const device = searchParams.get("device") || null;
    const workspace = searchParams.get("workspace") || null;
    const from = searchParams.get("from") || null;
    const to = searchParams.get("to") || null;
    const tag = searchParams.get("tag") || null;
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];

    if (userId) {
      conditions.push(eq(schema.prompts.userId, userId));
    }

    if (search) {
      conditions.push(
        sql`${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${search})`
      );
    }

    if (project) {
      conditions.push(eq(schema.prompts.projectName, project));
    }

    if (type) {
      conditions.push(eq(schema.prompts.promptType, type));
    }

    if (device) {
      conditions.push(eq(schema.prompts.deviceName, device));
    }

    if (workspace) {
      conditions.push(eq(schema.prompts.workingDirectory, workspace));
    }

    if (from) {
      conditions.push(gte(schema.prompts.timestamp, new Date(from)));
    }

    if (to) {
      const toDate = new Date(to);
      toDate.setUTCHours(23, 59, 59, 999);
      conditions.push(lte(schema.prompts.timestamp, toDate));
    }

    if (tag) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${schema.promptTags} pt
        JOIN ${schema.tags} t ON pt.tag_id = t.id
        WHERE pt.prompt_id = ${schema.prompts.id} AND t.name = ${tag}
      )`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const userCondition = userId
      ? and(sql`project_name is not null`, eq(schema.prompts.userId, userId))
      : sql`project_name is not null`;

    const [items, countResult, projectsResult, allTags, userList, devicesResult, workspacesResult] =
      await Promise.all([
        db.query.prompts.findMany({
          where: whereClause,
          orderBy: [desc(schema.prompts.timestamp)],
          limit: pageSize,
          offset,
          with: {
            promptTags: {
              with: {
                tag: true,
              },
            },
          },
        }),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.prompts)
          .where(whereClause),
        db
          .select({
            name: schema.prompts.projectName,
            count: sql<number>`count(*)`,
          })
          .from(schema.prompts)
          .where(userCondition)
          .groupBy(schema.prompts.projectName)
          .orderBy(desc(sql`count(*)`)),
        db.select().from(schema.tags).orderBy(schema.tags.name),
        db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
          })
          .from(schema.users)
          .orderBy(schema.users.email),
        // Distinct devices
        db
          .select({
            name: schema.prompts.deviceName,
            count: sql<number>`count(*)`,
          })
          .from(schema.prompts)
          .where(sql`device_name is not null`)
          .groupBy(schema.prompts.deviceName)
          .orderBy(desc(sql`count(*)`)),
        // Distinct workspaces (top 50)
        db
          .select({
            name: schema.prompts.workingDirectory,
            count: sql<number>`count(*)`,
          })
          .from(schema.prompts)
          .where(sql`working_directory is not null AND working_directory != 'unknown'`)
          .groupBy(schema.prompts.workingDirectory)
          .orderBy(desc(sql`count(*)`))
          .limit(50),
      ]);

    // Look up user info for each prompt
    const userIds = [...new Set(items.map((i) => i.userId).filter(Boolean))];
    const userMap = new Map<string, { name: string | null; email: string }>();
    if (userIds.length > 0) {
      const users = await db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.users)
        .where(sql`${schema.users.id} IN ${userIds}`);
      for (const u of users) {
        userMap.set(u.id, { name: u.name, email: u.email });
      }
    }

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        timestamp: item.timestamp,
        projectName: item.projectName,
        promptType: item.promptType || "user_input",
        tokenCount: item.tokenEstimate ?? Math.ceil(item.promptLength / 4),
        preview:
          item.promptText.slice(0, 200) +
          (item.promptText.length > 200 ? "..." : ""),
        tags: item.promptTags.map((pt) => pt.tag),
        user: item.userId ? userMap.get(item.userId) ?? null : null,
        source: item.source,
        deviceName: item.deviceName,
        workingDirectory: item.workingDirectory,
      })),
      totalCount: Number(countResult[0]?.count ?? 0),
      projects: projectsResult.map((p) => ({
        name: p.name ?? "",
        count: Number(p.count),
      })),
      allTags,
      users: userList,
      devices: devicesResult.map((d) => ({
        name: d.name ?? "",
        count: Number(d.count),
      })),
      workspaces: workspacesResult.map((w) => ({
        name: w.name ?? "",
        count: Number(w.count),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin prompts API error:", error);
    return NextResponse.json(
      { error: "Failed to load prompts" },
      { status: 500 }
    );
  }
}
