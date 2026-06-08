ALTER TABLE "analyses" ADD COLUMN "cancel_requested" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "available_stages" jsonb DEFAULT '[]'::jsonb NOT NULL;