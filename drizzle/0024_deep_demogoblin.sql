CREATE TABLE "app"."background_job_tasks" (
	"name" varchar(60) PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'IDLE' NOT NULL,
	"run_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(60),
	"last_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_job_status_ck" CHECK ("app"."background_job_tasks"."status" in ('IDLE','RUNNING','SUCCEEDED','FAILED')),
	CONSTRAINT "background_job_failures_ck" CHECK ("app"."background_job_tasks"."consecutive_failures" >= 0),
	CONSTRAINT "background_job_lease_ck" CHECK ("app"."background_job_tasks"."status" <> 'RUNNING' or ("app"."background_job_tasks"."run_id" is not null and "app"."background_job_tasks"."lease_expires_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."notification_records" DROP CONSTRAINT "notification_status_ck";--> statement-breakpoint
CREATE INDEX "notification_pending_idx" ON "app"."notification_records" USING btree ("created_at") WHERE "app"."notification_records"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "app"."notification_records" ADD CONSTRAINT "notification_status_ck" CHECK ("app"."notification_records"."status" in ('PENDING','PROCESSING','SENT','FAILED','DEV_PREVIEW','SKIPPED'));
--> statement-breakpoint
ALTER TABLE app.background_job_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.background_job_tasks FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.background_job_tasks FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON app.background_job_tasks FROM authenticated;
  END IF;
END $$;
