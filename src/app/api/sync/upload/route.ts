import { NextRequest, NextResponse } from "next/server";
import { findUserByToken } from "@/services/sync";
import { processUpload } from "@/services/upload";
import type { UploadRecord } from "@/services/upload";

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RECORDS_PER_REQUEST = 1000;

export async function POST(request: NextRequest) {
  try {
    // Auth via X-User-Token header (validated by middleware)
    const userToken =
      request.headers.get("x-user-token") || request.headers.get("X-User-Token");

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
    const body = await request.json();

    if (!body.records || !Array.isArray(body.records)) {
      return NextResponse.json(
        { error: "Request body must contain a 'records' array" },
        { status: 400 }
      );
    }

    if (body.records.length > MAX_RECORDS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many records. Maximum ${MAX_RECORDS_PER_REQUEST} per request.` },
        { status: 400 }
      );
    }

    if (body.records.length === 0) {
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
      body.records as UploadRecord[],
      user.id,
      user.token,
    );

    return NextResponse.json(result, {
      status: result.success ? 200 : 207, // 207 Multi-Status for partial success
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "An error occurred during upload" },
      { status: 500 }
    );
  }
}
