CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"subsystem" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"match_component" text,
	"match_any_of" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_all_of" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"freq_min_per_minute" integer,
	"cause" text,
	"solution" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applies_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retrieval_query" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
