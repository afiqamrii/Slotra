CREATE TABLE "app"."report_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"period_start" varchar(10) NOT NULL,
	"period_end" varchar(10) NOT NULL,
	"recipient" text NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_deliveries_status_ck" CHECK ("app"."report_deliveries"."status" in ('PENDING','PROCESSING','SENT','FAILED','DEV_PREVIEW'))
);
--> statement-breakpoint
CREATE TABLE "app"."report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"report_type" varchar(20) DEFAULT 'OVERVIEW' NOT NULL,
	"frequency" varchar(20) NOT NULL,
	"recipients" jsonb NOT NULL,
	"timezone" text NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_type_ck" CHECK ("app"."report_schedules"."report_type" in ('OVERVIEW','REVENUE','BOOKINGS','RESOURCES','CUSTOMERS')),
	CONSTRAINT "report_schedules_frequency_ck" CHECK ("app"."report_schedules"."frequency" in ('WEEKLY','MONTHLY'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "report_schedules_org_id_uq" ON "app"."report_schedules" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."report_deliveries" ADD CONSTRAINT "report_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_deliveries" ADD CONSTRAINT "report_deliveries_org_schedule_fk" FOREIGN KEY ("organization_id","schedule_id") REFERENCES "app"."report_schedules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_schedules" ADD CONSTRAINT "report_schedules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_deliveries_once_uq" ON "app"."report_deliveries" USING btree ("schedule_id","period_start","recipient");--> statement-breakpoint
CREATE INDEX "report_deliveries_org_schedule_idx" ON "app"."report_deliveries" USING btree ("organization_id","schedule_id");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "app"."report_schedules" USING btree ("next_run_at") WHERE "app"."report_schedules"."is_active" = true;--> statement-breakpoint
CREATE INDEX "report_schedules_org_idx" ON "app"."report_schedules" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "app"."report_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."report_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."report_schedules" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."report_deliveries" FROM PUBLIC;
