import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { parseDateRange } from "../_helpers";
import { computeSessions } from "@/lib/session-analysis";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { and, eq, gte, lt } from "drizzle-orm";

function toDateOnlyString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.userId;

    const url = new URL(request.url);
    const { from, to } = parseDateRange(url.searchParams);

    const rows = await db
      .select({
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
      })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, userId),
          gte(schema.prompts.timestamp, from),
          lt(schema.prompts.timestamp, to),
          eq(schema.prompts.promptType, "user_input")
        )
      )
      .orderBy(schema.prompts.timestamp);

    const sessions = computeSessions(rows);

    const sessionsCount = sessions.length;
    const totalPrompts = sessions.reduce((acc, s) => acc + s.promptCount, 0);
    const totalMinutes = sessions.reduce(
      (acc, s) => acc + (s.end.getTime() - s.start.getTime()) / 60000,
      0
    );

    const avgPromptsPerSession =
      sessionsCount === 0 ? 0 : Math.round(totalPrompts / sessionsCount);
    const avgSessionMinutes =
      sessionsCount === 0 ? 0 : Math.round(totalMinutes / sessionsCount);

    const sessionsPerDayMap = new Map<string, number>();
    for (const s of sessions) {
      const day = toDateOnlyString(s.start);
      sessionsPerDayMap.set(day, (sessionsPerDayMap.get(day) ?? 0) + 1);
    }

    const sessionsPerDay = [...sessionsPerDayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, sessions: count }));

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        sessions: sessionsCount,
        avgPromptsPerSession,
        avgSessionMinutes,
      },
      sessionsPerDay,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Analytics sessions API error:", error);
    return NextResponse.json(
      { error: "Failed to load sessions analytics" },
      { status: 500 }
    );
  }
}
