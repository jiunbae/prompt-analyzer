import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByToken } from "@/services/sync";
import { processUpload } from "@/services/upload";
import type { UploadRecord } from "@/services/upload";
import { dispatchWebhook } from "@/services/webhook";
import { logger } from "@/lib/logger";
import { env } from "@/env";
import { scorePrompt } from "@/services/quality-scorer";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RECORDS_PER_REQUEST = 1000;

const uploadRecordSchema = z.object({
  event_id: z.string().min(1),
  created_at: z.string().min(1),
  prompt_text: z.string(),
  response_text: z.string().nullish(),
  prompt_length: z.number(),
  response_length: z.number().nullish(),
  project: z.string().nullish(),
  cwd: z.string().nullish(),
  source: z.string().nullish(),
  session_id: z.string().nullish(),
  role: z.string().nullish(),
  model: z.string().nullish(),
  cli_name: z.string().nullish(),
  cli_version: z.string().nullish(),
  token_estimate: z.number().nullish(),
  token_estimate_response: z.number().nullish(),
  word_count: z.number().nullish(),
  word_count_response: z.number().nullish(),
  content_hash: z.string().nullish(),
});

const uploadBodySchema = z.object({
  records: z.array(uploadRecordSchema).max(MAX_RECORDS_PER_REQUEST),
  deviceId: z.string().optional(),
});

function sanitizeEventId(eventId: string): string {
  return eventId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildEventKey(userToken: string, createdAt: Date, eventId: string): string {
  const yyyy = createdAt.getUTCFullYear();
  const mm = String(createdAt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(createdAt.getUTCDate()).padStart(2, "0");
  const safeId = sanitizeEventId(eventId);
  return `${userToken}/${yyyy}/${mm}/${dd}/${safeId}.json`;
}

async function scoreUploadedPrompts(
  userId: string,
  userToken: string,
  records: UploadRecord[],
): Promise<number> {
  const eventKeys = Array.from(
    new Set(
      records
        .map((record) => {
          const createdAt = new Date(record.created_at);
          if (Number.isNaN(createdAt.getTime())) {
            return null;
          }
          return buildEventKey(userToken, createdAt, record.event_id);
        })
        .filter((eventKey): eventKey is string => typeof eventKey === "string"),
    ),
  );

  if (eventKeys.length === 0) return 0;

  const client = postgres(env.DATABASE_URL);
  const db = drizzle(client, { schema });

  try {
    const promptsToScore = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
      })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, userId),
          eq(schema.prompts.promptType, "user_input"),
          inArray(schema.prompts.eventKey, eventKeys),
          isNull(schema.prompts.qualityClarity),
        ),
      );

    const now = new Date();
    const SCORE_BATCH_SIZE = 50;
    for (let i = 0; i < promptsToScore.length; i += SCORE_BATCH_SIZE) {
      const batch = promptsToScore.slice(i, i + SCORE_BATCH_SIZE);
      await Promise.all(
        batch.map((prompt) => {
          const score = scorePrompt(prompt.promptText);
          return db
            .update(schema.prompts)
            .set({
              qualityScore: score.overall,
              qualityClarity: score.clarity,
              qualitySpecificity: score.specificity,
              qualityContext: score.context,
              qualityConstraints: score.constraints,
              qualityStructure: score.structure,
              qualityDetails: {
                method: "heuristic-v1",
                ...score,
              },
              enrichedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.prompts.id, prompt.id),
                eq(schema.prompts.userId, userId),
              ),
            );
        }),
      );
    }

    return promptsToScore.length;
  } finally {
    await client.end();
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth via X-User-Token header
    const userToken = request.headers.get("X-User-Token");

    if (!userToken) {
      return NextResponse.json(
        { error: "Authentication required. Provide X-User-Token header." },
        { status: 401 }
      );
    }

    // Look up user by token
    const user = await findUserByToken(userToken);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid user token" },
        { status: 401 }
      );
    }

    // Check content length
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
      return NextResponse.json(
        { error: `Request body too large. Maximum ${MAX_BODY_SIZE / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }

    // Parse request body
    let rawBody;
    try {
      const rawText = await request.text();
      if (Buffer.byteLength(rawText, "utf8") > MAX_BODY_SIZE) {
        return NextResponse.json(
          { error: `Request body too large. Maximum ${MAX_BODY_SIZE / 1024 / 1024}MB.` },
          { status: 413 }
        );
      }
      rawBody = JSON.parse(rawText);
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error({ error }, "Failed to parse request body as JSON");
        return NextResponse.json(
          { error: "Invalid JSON in request body" },
          { status: 400 }
        );
      }
      throw error;
    }

    // Validate with Zod
    const parseResult = uploadBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parseResult.error.issues.slice(0, 10) },
        { status: 400 }
      );
    }

    const { records, deviceId } = parseResult.data;
    const typedRecords = records as UploadRecord[];

    if (records.length === 0) {
      return NextResponse.json({
        success: true,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        errors: [],
      });
    }

    // Process the upload
    const result = await processUpload(
      typedRecords,
      user.id,
      user.token,
      deviceId,
    );

    if (result.accepted > 0) {
      try {
        await scoreUploadedPrompts(user.id, user.token, typedRecords);
      } catch (scoreError) {
        logger.error(
          { error: scoreError, userId: user.id },
          "Failed to score uploaded prompts",
        );
      }

      // Fire webhook notification (non-blocking)
      dispatchWebhook(user.id, "prompt.created", { count: result.accepted }).catch((err) => {
        logger.error({ error: err, userId: user.id }, "Non-blocking webhook dispatch failed");
      });
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 207, // 207 Multi-Status for partial success
    });
  } catch (error) {
    logger.error({ error }, "Upload error");
    return NextResponse.json(
      { error: "An error occurred during upload" },
      { status: 500 }
    );
  }
}
