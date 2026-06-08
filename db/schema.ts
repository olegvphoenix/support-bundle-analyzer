import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AnalysisReport } from "@/lib/analyzer/types";

export const analyses = pgTable("analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  storageKey: text("storage_key"),
  status: text("status", {
    enum: ["queued", "processing", "done", "error", "cancelled"],
  })
    .notNull()
    .default("queued"),
  progress: integer("progress").notNull().default(0),
  stage: text("stage").notNull().default(""),
  // Cooperative cancellation flag — the worker checks it between stages.
  cancelRequested: integer("cancel_requested").notNull().default(0),
  // Stage keys whose output checkpoint is persisted (enables per-stage restart).
  availableStages: jsonb("available_stages").$type<string[]>().notNull().default([]),
  // Denormalized fields for fast history listing.
  product: text("product"),
  version: text("version"),
  host: text("host"),
  healthScore: integer("health_score"),
  problemCount: integer("problem_count"),
  report: jsonb("report").$type<AnalysisReport>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;

// Dynamic OEM registry. New OEM brands ship ~monthly, so this is data (editable
// via Settings) rather than hardcoded. Detection still auto-recognizes unknown
// brands from the head-log basename; entries here give friendly names/grouping.
export const oemProfiles = pgTable("oem_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  product: text("product").notNull(),
  brandKey: text("brand_key"),
  // Invariant matchers (at least one recommended).
  headLog: text("head_log"),
  versionPrefix: text("version_prefix"),
  // Optional explicit family override: axxon3 | axxon5 | unknown.
  family: text("family"),
  active: integer("active").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OemProfile = typeof oemProfiles.$inferSelect;
export type NewOemProfile = typeof oemProfiles.$inferInsert;

// Application settings — a single JSON document (id = 1). Editable via the
// Settings UI; the pipeline/worker read it with env-var fallback so the box
// still works before anything is configured in the UI.
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppSettingsRow = typeof appSettings.$inferSelect;

// Knowledge-base rules stored in the DB (in addition to the built-in YAML base).
// Editable via the UI and grown over time, including "save as rule" capture from
// analysis findings — this is what makes the analyzer learnable.
export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Logical key used as the rule id by the engine (slug, unique).
  key: text("key").notNull(),
  severity: text("severity").notNull().default("warning"),
  subsystem: text("subsystem").notNull().default("other"),
  title: text("title").notNull(),
  matchComponent: text("match_component"),
  matchAnyOf: jsonb("match_any_of").$type<string[]>().notNull().default([]),
  matchAllOf: jsonb("match_all_of").$type<string[]>().notNull().default([]),
  freqMinPerMinute: integer("freq_min_per_minute"),
  cause: text("cause"),
  solution: jsonb("solution").$type<string[]>().notNull().default([]),
  appliesTo: jsonb("applies_to").$type<string[]>().notNull().default([]),
  retrievalQuery: text("retrieval_query"),
  enabled: integer("enabled").notNull().default(1),
  // manual | captured (from an analysis finding)
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RuleRow = typeof rules.$inferSelect;
export type NewRuleRow = typeof rules.$inferInsert;
