import { NextRequest, NextResponse } from "next/server";
import {
  syncAll,
  syncIncremental,
  getLastSyncStatus,
  isSyncRunning,
  findUserByToken,
} from "@/services/sync";
import { isMinioConfigured, testMinioConnection } from "@/lib/minio";

/**
 * POST /api/sync - Trigger a sync operation
 *
 * Authentication (one of the following):
 * - Header: X-User-Token: {user_token} (for external tools like Claude Code hook)
 * - Cookie: auth_session (for web UI)
 *
 * Request body:
 * - type: "full" | "incremental" (default: "full")
 * - since: ISO date string (required for incremental sync)
 */
export async function POST(request: NextRequest) {
  try {
    // Check if MinIO is configured
    if (!isMinioConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: "MinIO client is not properly configured. Check environment variables.",
        },
        { status: 503 }
      );
    }

    // Authenticate user - try X-User-Token header first (for external tools)
    // then fall back to session cookie (for web UI)
    let userId: string | undefined;
    let userToken: string | undefined;

    const tokenHeader = request.headers.get("X-User-Token");
    if (tokenHeader) {
      // External tool authentication via token
      const user = await findUserByToken(tokenHeader);
      if (!user) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid user token",
          },
          { status: 401 }
        );
      }
      userId = user.id;
      userToken = user.token;
      console.log(`Sync requested by user (token auth): ${user.email}`);
    } else {
      // Web UI authentication via middleware headers
      const headerUserId = request.headers.get("x-user-id");
      const headerUserToken = request.headers.get("x-user-token");

      if (headerUserId && headerUserToken) {
        userId = headerUserId;
        userToken = headerUserToken;
        console.log(`Sync requested by user (session auth): ${headerUserId}`);
      }
    }

    // Check if sync is already running
    const running = await isSyncRunning();
    if (running) {
      return NextResponse.json(
        {
          success: false,
          error: "A sync operation is already in progress",
        },
        { status: 409 }
      );
    }

    // Test MinIO connection
    const connected = await testMinioConnection();
    if (!connected) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to connect to MinIO. Check credentials and endpoint.",
        },
        { status: 503 }
      );
    }

    // Parse request body
    let body: { type?: string; since?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is OK, default to full sync
    }

    const syncType = body.type || "full";

    // Build sync options with user context
    const syncOptions = userId && userToken
      ? { userId, userToken }
      : undefined;

    console.log(
      `Starting ${syncType} sync...${syncOptions ? ` (user-scoped: ${userToken})` : " (global)"}`
    );

    let result;
    if (syncType === "incremental") {
      if (!body.since) {
        return NextResponse.json(
          {
            success: false,
            error: "Incremental sync requires 'since' date parameter",
          },
          { status: 400 }
        );
      }

      const sinceDate = new Date(body.since);
      if (isNaN(sinceDate.getTime())) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid 'since' date format. Use ISO 8601 format.",
          },
          { status: 400 }
        );
      }

      result = await syncIncremental(sinceDate, syncOptions);
    } else {
      result = await syncAll(syncOptions);
    }

    return NextResponse.json({
      success: result.success,
      type: syncType,
      userScoped: !!syncOptions,
      filesProcessed: result.filesProcessed,
      filesAdded: result.filesAdded,
      filesSkipped: result.filesSkipped,
      duration: result.duration,
      errors: result.errors.length > 0 ? result.errors.slice(0, 10) : undefined,
      errorCount: result.errors.length,
    });
  } catch (error) {
    console.error("Sync API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sync - Get sync status
 *
 * Query parameters:
 * - check: "connection" - Test MinIO connection only
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const check = searchParams.get("check");

    // If checking connection only
    if (check === "connection") {
      if (!isMinioConfigured()) {
        return NextResponse.json({
          configured: false,
          connected: false,
          message: "MinIO environment variables are not set",
        });
      }

      const connected = await testMinioConnection();
      return NextResponse.json({
        configured: true,
        connected,
        message: connected
          ? "Successfully connected to MinIO"
          : "Failed to connect to MinIO",
      });
    }

    // Get sync status
    const lastSync = await getLastSyncStatus();
    const running = await isSyncRunning();

    return NextResponse.json({
      lastSync,
      isRunning: running,
      minioConfigured: isMinioConfigured(),
    });
  } catch (error) {
    console.error("Sync status API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
