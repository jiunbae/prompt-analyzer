import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByToken } from "@/services/sync";
import { processUpload } from "@/services/upload";
import type { UploadRecord } from "@/services/upload";
import { dispatchWebhook } from "@/services/webhook";
import { logger } from "@/lib/logger";

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
