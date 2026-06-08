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
    enum: ["queued", "processing", "done", "error"],
  })
    .notNull()
    .default("queued"),
  progress: integer("progress").notNull().default(0),
  stage: text("stage").notNull().default(""),
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
