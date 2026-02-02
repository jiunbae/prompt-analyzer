import { getMinioClient, PROMPTS_BUCKET, isMinioConfigured } from "@/lib/minio";
import type {
  MinioPrompt,
  PromptType,
  PromptMetadata,
  ProcessedPrompt,
  SyncResult,
  MinioObjectInfo,
} from "./types";

/**
 * Extract project name from working directory path
 *
 * @param dir - Working directory path (e.g., "/Users/username/workspace/my-project/src")
 * @returns Project name or null if not found
 */
export function extractProjectName(dir: string): string | null {
  // Pattern: /Users/username/workspace/{project}/...
  // or: /Users/username/{project}/...
  const match = dir.match(/\/Users\/username\/(?:workspace\/)?([^\/]+)/);
  return match ? match[1] : null;
}

/**
 * Detect prompt type based on content markers
 *
 * @param prompt - Prompt text content
 * @returns Prompt type classification
 */
export function detectPromptType(prompt: string): PromptType {
  if (prompt.includes("<task-notification>")) return "task_notification";
  if (prompt.includes("<system-reminder>")) return "system";
  return "user_input";
}

/**
 * Estimate token count from text
 * Uses rough estimation of ~4 characters per token for English
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Count words in text
 *
 * @param text - Text to count words in
 * @returns Word count
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Extract metadata from prompt content
 *
 * @param prompt - Raw prompt text
 * @param workingDirectory - Working directory path
 * @returns Extracted metadata
 */
export function extractMetadata(
  prompt: string,
  workingDirectory: string
): PromptMetadata {
  return {
    projectName: extractProjectName(workingDirectory),
    promptType: detectPromptType(prompt),
    tokenEstimate: estimateTokens(prompt),
    wordCount: countWords(prompt),
  };
}

/**
 * List all JSON objects in the MinIO bucket
 *
 * @param bucket - Bucket name to list from
 * @param prefix - Optional prefix to filter objects
 * @returns Array of object information
 */
export async function listAllObjects(
  bucket: string = PROMPTS_BUCKET,
  prefix?: string
): Promise<MinioObjectInfo[]> {
  if (!isMinioConfigured()) {
    throw new Error("MinIO client is not properly configured");
  }

  const objects: MinioObjectInfo[] = [];

  return new Promise((resolve, reject) => {
    const stream = getMinioClient().listObjectsV2(bucket, prefix, true);

    stream.on("data", (obj) => {
      // Only include JSON files
      if (obj.name && obj.name.endsWith(".json")) {
        objects.push({
          name: obj.name,
          lastModified: obj.lastModified,
          etag: obj.etag,
          size: obj.size,
        });
      }
    });

    stream.on("error", (err) => {
      console.error("Error listing objects:", err);
      reject(err);
    });

    stream.on("end", () => {
      console.log(`Listed ${objects.length} JSON objects from ${bucket}`);
      resolve(objects);
    });
  });
}

/**
 * Fetch and parse a single prompt from MinIO
 *
 * @param key - Object key (path) in the bucket
 * @param bucket - Bucket name
 * @returns Parsed prompt data or null if invalid
 */
export async function fetchPrompt(
  key: string,
  bucket: string = PROMPTS_BUCKET
): Promise<MinioPrompt | null> {
  if (!isMinioConfigured()) {
    throw new Error("MinIO client is not properly configured");
  }

  try {
    const stream = await getMinioClient().getObject(bucket, key);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        try {
          const data = Buffer.concat(chunks).toString("utf-8");
          const prompt = JSON.parse(data) as MinioPrompt;

          // Validate required fields
          if (
            !prompt.timestamp ||
            !prompt.working_directory ||
            prompt.prompt_length === undefined ||
            !prompt.prompt
          ) {
            console.warn(`Invalid prompt format in ${key}`);
            resolve(null);
            return;
          }

          resolve(prompt);
        } catch (parseError) {
          console.error(`Error parsing JSON from ${key}:`, parseError);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error(`Error fetching ${key}:`, error);
    return null;
  }
}

/**
 * Process a raw MinIO prompt into database-ready format
 *
 * @param minioPrompt - Raw prompt from MinIO
 * @param key - Object key
 * @returns Processed prompt for database insertion
 */
export function processPrompt(
  minioPrompt: MinioPrompt,
  key: string
): ProcessedPrompt {
  const metadata = extractMetadata(
    minioPrompt.prompt,
    minioPrompt.working_directory
  );

  return {
    minioKey: key,
    timestamp: new Date(minioPrompt.timestamp),
    workingDirectory: minioPrompt.working_directory,
    promptLength: minioPrompt.prompt_length,
    promptText: minioPrompt.prompt,
    ...metadata,
  };
}

// Import database utilities lazily to avoid circular dependencies
let db: ReturnType<typeof import("drizzle-orm/postgres-js").drizzle> | null =
  null;
let promptsTable: typeof import("@/db/schema").prompts | null = null;
let syncLogTable: typeof import("@/db/schema").minioSyncLog | null = null;

async function getDb() {
  if (!db) {
    const postgres = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const schema = await import("@/db/schema");

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }

    const client = postgres.default(connectionString);
    db = drizzle(client, { schema });
    promptsTable = schema.prompts;
    syncLogTable = schema.minioSyncLog;
  }

  return { db, promptsTable: promptsTable!, syncLogTable: syncLogTable! };
}

/**
 * Perform a full sync of all prompts from MinIO to database
 *
 * @returns Sync result summary
 */
export async function syncAll(): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let filesProcessed = 0;
  let filesAdded = 0;
  let filesSkipped = 0;

  console.log("Starting full sync from MinIO...");

  try {
    const { db, promptsTable, syncLogTable } = await getDb();
    const { eq } = await import("drizzle-orm");

    // Create sync log entry
    const [syncLog] = await db
      .insert(syncLogTable)
      .values({
        status: "running",
        filesProcessed: 0,
        filesAdded: 0,
        filesSkipped: 0,
      })
      .returning();

    try {
      // List all objects
      const objects = await listAllObjects();
      console.log(`Found ${objects.length} objects to process`);

      // Get existing keys to avoid duplicates
      const existingPrompts = await db
        .select({ minioKey: promptsTable.minioKey })
        .from(promptsTable);
      const existingKeys = new Set(existingPrompts.map((p) => p.minioKey));
      console.log(`Found ${existingKeys.size} existing prompts in database`);

      // Process each object
      for (const obj of objects) {
        filesProcessed++;

        // Skip if already exists
        if (existingKeys.has(obj.name)) {
          filesSkipped++;
          continue;
        }

        try {
          const prompt = await fetchPrompt(obj.name);
          if (!prompt) {
            errors.push(`Failed to parse: ${obj.name}`);
            continue;
          }

          const processed = processPrompt(prompt, obj.name);

          await db.insert(promptsTable).values(processed);
          filesAdded++;

          if (filesAdded % 50 === 0) {
            console.log(`Progress: ${filesAdded} prompts added`);
          }
        } catch (insertError) {
          const message =
            insertError instanceof Error
              ? insertError.message
              : String(insertError);
          errors.push(`Error inserting ${obj.name}: ${message}`);
        }
      }

      // Update sync log with success
      await db
        .update(syncLogTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          filesProcessed,
          filesAdded,
          filesSkipped,
        })
        .where(eq(syncLogTable.id, syncLog.id));
    } catch (error) {
      // Update sync log with failure
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await db
        .update(syncLogTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          filesProcessed,
          filesAdded,
          filesSkipped,
          errorMessage,
        })
        .where(eq(syncLogTable.id, syncLog.id));

      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Sync failed: ${message}`);
    console.error("Sync failed:", error);
  }

  const duration = Date.now() - startTime;
  console.log(
    `Sync completed in ${duration}ms: ${filesAdded} added, ${filesSkipped} skipped, ${errors.length} errors`
  );

  return {
    success: errors.length === 0,
    filesProcessed,
    filesAdded,
    filesSkipped,
    errors,
    duration,
  };
}

/**
 * Perform incremental sync for prompts since a given date
 * Uses the date-based folder structure: {year}/{month}/{day}/
 *
 * @param since - Date to sync from
 * @returns Sync result summary
 */
export async function syncIncremental(since: Date): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let filesProcessed = 0;
  let filesAdded = 0;
  let filesSkipped = 0;

  console.log(`Starting incremental sync from ${since.toISOString()}...`);

  try {
    const { db, promptsTable, syncLogTable } = await getDb();
    const { eq, gte } = await import("drizzle-orm");

    // Create sync log entry
    const [syncLog] = await db
      .insert(syncLogTable)
      .values({
        status: "running",
        filesProcessed: 0,
        filesAdded: 0,
        filesSkipped: 0,
      })
      .returning();

    try {
      // Build prefixes for relevant dates
      const prefixes = getDatePrefixes(since, new Date());
      console.log(`Scanning ${prefixes.length} date prefixes`);

      // Get existing keys for the date range
      const existingPrompts = await db
        .select({ minioKey: promptsTable.minioKey })
        .from(promptsTable)
        .where(gte(promptsTable.timestamp, since));
      const existingKeys = new Set(existingPrompts.map((p) => p.minioKey));

      // Process each date prefix
      for (const prefix of prefixes) {
        const objects = await listAllObjects(PROMPTS_BUCKET, prefix);

        for (const obj of objects) {
          filesProcessed++;

          if (existingKeys.has(obj.name)) {
            filesSkipped++;
            continue;
          }

          try {
            const prompt = await fetchPrompt(obj.name);
            if (!prompt) {
              errors.push(`Failed to parse: ${obj.name}`);
              continue;
            }

            // Check if prompt is actually after the since date
            const promptDate = new Date(prompt.timestamp);
            if (promptDate < since) {
              filesSkipped++;
              continue;
            }

            const processed = processPrompt(prompt, obj.name);
            await db.insert(promptsTable).values(processed);
            filesAdded++;
          } catch (insertError) {
            const message =
              insertError instanceof Error
                ? insertError.message
                : String(insertError);
            errors.push(`Error inserting ${obj.name}: ${message}`);
          }
        }
      }

      // Update sync log with success
      await db
        .update(syncLogTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          filesProcessed,
          filesAdded,
          filesSkipped,
        })
        .where(eq(syncLogTable.id, syncLog.id));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await db
        .update(syncLogTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          filesProcessed,
          filesAdded,
          filesSkipped,
          errorMessage,
        })
        .where(eq(syncLogTable.id, syncLog.id));

      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Incremental sync failed: ${message}`);
    console.error("Incremental sync failed:", error);
  }

  const duration = Date.now() - startTime;
  console.log(
    `Incremental sync completed in ${duration}ms: ${filesAdded} added, ${filesSkipped} skipped, ${errors.length} errors`
  );

  return {
    success: errors.length === 0,
    filesProcessed,
    filesAdded,
    filesSkipped,
    errors,
    duration,
  };
}

/**
 * Generate date prefixes for MinIO path structure
 * Format: {year}/{month}/{day}/
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Array of path prefixes
 */
function getDatePrefixes(startDate: Date, endDate: Date): string[] {
  const prefixes: string[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    prefixes.push(`${year}/${month}/${day}/`);
    current.setDate(current.getDate() + 1);
  }

  return prefixes;
}

/**
 * Get the status of the last sync operation
 *
 * @returns Last sync status or null if no syncs have been performed
 */
export async function getLastSyncStatus() {
  try {
    const { db, syncLogTable } = await getDb();
    const { desc } = await import("drizzle-orm");

    const [lastSync] = await db
      .select()
      .from(syncLogTable)
      .orderBy(desc(syncLogTable.startedAt))
      .limit(1);

    if (!lastSync) {
      return null;
    }

    return {
      id: lastSync.id,
      startedAt: lastSync.startedAt,
      completedAt: lastSync.completedAt,
      status: lastSync.status as "running" | "completed" | "failed",
      filesProcessed: lastSync.filesProcessed ?? 0,
      filesAdded: lastSync.filesAdded ?? 0,
      filesSkipped: lastSync.filesSkipped ?? 0,
      errorMessage: lastSync.errorMessage,
    };
  } catch (error) {
    console.error("Error getting last sync status:", error);
    return null;
  }
}

/**
 * Check if a sync is currently running
 *
 * @returns True if a sync is in progress
 */
export async function isSyncRunning(): Promise<boolean> {
  try {
    const { db, syncLogTable } = await getDb();
    const { desc } = await import("drizzle-orm");

    const [lastSync] = await db
      .select()
      .from(syncLogTable)
      .orderBy(desc(syncLogTable.startedAt))
      .limit(1);

    return lastSync?.status === "running";
  } catch (error) {
    console.error("Error checking sync status:", error);
    return false;
  }
}
