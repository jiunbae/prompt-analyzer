import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  timestamp,
  date,
  numeric,
  primaryKey,
  index,
  boolean,
  customType,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// Users table
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    token: uuid("token")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`), // for MinIO path
    name: varchar("name", { length: 100 }),
    isAdmin: boolean("is_admin").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_users_email").on(table.email),
    index("idx_users_token").on(table.token),
  ]
);

// Allowed emails table (admin allowlist)
export const allowedEmails = pgTable("allowed_emails", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  addedBy: uuid("added_by").references(() => users.id),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
});

// Prompts table (main entity)
export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    minioKey: varchar("minio_key", { length: 255 }).notNull().unique(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    workingDirectory: varchar("working_directory", { length: 500 }),
    promptLength: integer("prompt_length").notNull(),
    promptText: text("prompt_text").notNull(),
    responseText: text("response_text"),
    responseLength: integer("response_length"),

    // Extracted metadata
    projectName: varchar("project_name", { length: 255 }),
    promptType: varchar("prompt_type", { length: 50 }),

    // Provenance (optional; populated by clients when available)
    source: varchar("source", { length: 50 }),
    sessionId: varchar("session_id", { length: 255 }),

    userId: uuid("user_id").references(() => users.id),
    tokenEstimate: integer("token_estimate"),
    wordCount: integer("word_count"),
    tokenEstimateResponse: integer("token_estimate_response"),
    wordCountResponse: integer("word_count_response"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),

    searchVector: tsvector("search_vector"),
  },
  (table) => [
    index("idx_prompts_timestamp").on(table.timestamp),
    index("idx_prompts_project").on(table.projectName),
    index("idx_prompts_type").on(table.promptType),
    index("idx_prompts_minio_key").on(table.minioKey),
    index("idx_prompts_user").on(table.userId),
    index("idx_prompts_search_vector").using("gin", table.searchVector),
  ]
);

export const promptReviews = pgTable(
  "prompt_reviews",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    score: integer("score").notNull(), // 0-100
    scoreLabel: varchar("score_label", { length: 20 }).notNull(),
    signals: jsonb("signals").notNull(), // JSON array
    suggestions: jsonb("suggestions").notNull(), // JSON array
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_prompt_reviews_prompt_id").on(table.promptId)]
);

// Tags table
export const tags = pgTable("tags", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull().unique(),
  color: varchar("color", { length: 7 }).default("#6366f1"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Prompt tags junction table
export const promptTags = pgTable(
  "prompt_tags",
  {
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.promptId, table.tagId] })]
);

// Daily aggregations table
export const analyticsDaily = pgTable("analytics_daily", {
  date: date("date").primaryKey(),
  promptCount: integer("prompt_count").default(0),
  totalChars: integer("total_chars").default(0),
  totalTokensEst: integer("total_tokens_est").default(0),
  uniqueProjects: integer("unique_projects").default(0),
  avgPromptLength: numeric("avg_prompt_length", { precision: 10, scale: 2 }).default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// MinIO sync log table
export const minioSyncLog = pgTable("minio_sync_log", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).default("running"),
  filesProcessed: integer("files_processed").default(0),
  filesAdded: integer("files_added").default(0),
  filesSkipped: integer("files_skipped").default(0),
  errorMessage: text("error_message"),
  // Multi-user sync management columns
  userId: uuid("user_id").references(() => users.id),
  syncType: varchar("sync_type", { length: 20 }), // "manual", "auto", or "cron"
});

// Sync settings table (multi-user sync management)
export const syncSettings = pgTable("sync_settings", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .references(() => users.id)
    .unique(),
  autoSyncEnabled: boolean("auto_sync_enabled").default(false),
  syncIntervalMinutes: integer("sync_interval_minutes").default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  prompts: many(prompts),
  allowedEmails: many(allowedEmails),
  syncSettings: one(syncSettings),
  syncLogs: many(minioSyncLog),
}));

export const allowedEmailsRelations = relations(allowedEmails, ({ one }) => ({
  addedByUser: one(users, {
    fields: [allowedEmails.addedBy],
    references: [users.id],
  }),
}));

export const promptsRelations = relations(prompts, ({ one, many }) => ({
  promptTags: many(promptTags),
  promptReviews: many(promptReviews),
  user: one(users, {
    fields: [prompts.userId],
    references: [users.id],
  }),
}));

export const promptReviewsRelations = relations(promptReviews, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptReviews.promptId],
    references: [prompts.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  promptTags: many(promptTags),
}));

export const promptTagsRelations = relations(promptTags, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptTags.promptId],
    references: [prompts.id],
  }),
  tag: one(tags, {
    fields: [promptTags.tagId],
    references: [tags.id],
  }),
}));

export const syncSettingsRelations = relations(syncSettings, ({ one }) => ({
  user: one(users, {
    fields: [syncSettings.userId],
    references: [users.id],
  }),
}));

export const minioSyncLogRelations = relations(minioSyncLog, ({ one }) => ({
  user: one(users, {
    fields: [minioSyncLog.userId],
    references: [users.id],
  }),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type NewAllowedEmail = typeof allowedEmails.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type PromptReview = typeof promptReviews.$inferSelect;
export type NewPromptReview = typeof promptReviews.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type PromptTag = typeof promptTags.$inferSelect;
export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;
export type MinioSyncLog = typeof minioSyncLog.$inferSelect;
export type SyncSettings = typeof syncSettings.$inferSelect;
export type NewSyncSettings = typeof syncSettings.$inferInsert;
