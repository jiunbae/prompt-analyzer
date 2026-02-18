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
  uniqueIndex,
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
      .default(sql`gen_random_uuid()`), // for API auth
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
    eventKey: varchar("event_key", { length: 255 }).notNull().unique(),
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
    deviceName: varchar("device_name", { length: 255 }),

    userId: uuid("user_id").references(() => users.id),
    tokenEstimate: integer("token_estimate"),
    wordCount: integer("word_count"),
    tokenEstimateResponse: integer("token_estimate_response"),
    wordCountResponse: integer("word_count_response"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),

    // Enrichment fields (Phase 3)
    qualityScore: integer("quality_score"),
    topicTags: text("topic_tags").array(),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),

    searchVector: tsvector("search_vector"),
  },
  (table) => [
    index("idx_prompts_timestamp").on(table.timestamp),
    index("idx_prompts_project").on(table.projectName),
    index("idx_prompts_type").on(table.promptType),
    index("idx_prompts_event_key").on(table.eventKey),
    index("idx_prompts_user").on(table.userId),
    index("idx_prompts_session_id").on(table.sessionId),
    index("idx_prompts_search_vector").using("gin", table.searchVector),
    index("idx_prompts_user_timestamp").on(table.userId, table.timestamp),
    index("idx_prompts_user_project").on(table.userId, table.projectName),
  ]
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

// AI-generated insights cache
export const aiInsights = pgTable(
  "ai_insights",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    insightType: varchar("insight_type", { length: 100 }).notNull(),
    parameters: jsonb("parameters").notNull().default({}),
    dataHash: varchar("data_hash", { length: 64 }).notNull(),
    result: jsonb("result").notNull(),
    model: varchar("model", { length: 100 }),
    tokensUsed: integer("tokens_used"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_ai_insights_user_type").on(table.userId, table.insightType),
    index("idx_ai_insights_expires").on(table.expiresAt),
  ]
);

// Daily aggregations table
export const analyticsDaily = pgTable("analytics_daily", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  promptCount: integer("prompt_count").default(0),
  totalChars: integer("total_chars").default(0),
  totalTokensEst: integer("total_tokens_est").default(0),
  totalResponseTokens: integer("total_response_tokens").default(0),
  uniqueProjects: integer("unique_projects").default(0),
  avgPromptLength: numeric("avg_prompt_length", { precision: 10, scale: 2 }).default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("idx_analytics_daily_user_date").on(table.userId, table.date),
]);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  prompts: many(prompts),
  allowedEmails: many(allowedEmails),
}));

export const allowedEmailsRelations = relations(allowedEmails, ({ one }) => ({
  addedByUser: one(users, {
    fields: [allowedEmails.addedBy],
    references: [users.id],
  }),
}));

export const promptsRelations = relations(prompts, ({ one, many }) => ({
  promptTags: many(promptTags),
  user: one(users, {
    fields: [prompts.userId],
    references: [users.id],
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

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type NewAllowedEmail = typeof allowedEmails.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type PromptTag = typeof promptTags.$inferSelect;
export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;
export type AiInsight = typeof aiInsights.$inferSelect;
export type NewAiInsight = typeof aiInsights.$inferInsert;
