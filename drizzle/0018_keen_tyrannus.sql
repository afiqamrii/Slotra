CREATE TABLE "app"."automation_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"run_key" varchar(120) NOT NULL,
	"booking_id" uuid,
	"customer_id" uuid,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"error_summary" text,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_executions_status_ck" CHECK ("app"."automation_executions"."status" in ('PENDING','SENT','DEV_PREVIEW','FAILED','SKIPPED'))
);
--> statement-breakpoint
CREATE TABLE "app"."automation_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"trigger" varchar(40) NOT NULL,
	"action" varchar(40) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_workflows_trigger_ck" CHECK ("app"."automation_workflows"."trigger" in ('BOOKING_REMINDER','CUSTOMER_INACTIVE')),
	CONSTRAINT "automation_workflows_action_ck" CHECK ("app"."automation_workflows"."action" in ('EMAIL_REMINDER','TAG_INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "app"."business_booking_policies" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"minimum_notice_minutes" integer,
	"maximum_advance_days" integer,
	"maximum_duration_minutes" integer,
	"booking_buffer_minutes" integer DEFAULT 0 NOT NULL,
	"cancellation_cutoff_minutes" integer,
	"reschedule_cutoff_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_policy_values_ck" CHECK (("app"."business_booking_policies"."minimum_notice_minutes" is null or "app"."business_booking_policies"."minimum_notice_minutes" >= 0) and
    ("app"."business_booking_policies"."maximum_advance_days" is null or "app"."business_booking_policies"."maximum_advance_days" between 1 and 365) and
    ("app"."business_booking_policies"."maximum_duration_minutes" is null or "app"."business_booking_policies"."maximum_duration_minutes" between 30 and 1440) and
    "app"."business_booking_policies"."booking_buffer_minutes" between 0 and 180 and
    ("app"."business_booking_policies"."cancellation_cutoff_minutes" is null or "app"."business_booking_policies"."cancellation_cutoff_minutes" >= 0) and
    ("app"."business_booking_policies"."reschedule_cutoff_minutes" is null or "app"."business_booking_policies"."reschedule_cutoff_minutes" >= 0))
);
--> statement-breakpoint
ALTER TABLE "app"."automation_executions" ADD CONSTRAINT "automation_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_workflows_org_id_uq" ON "app"."automation_workflows" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."automation_executions" ADD CONSTRAINT "automation_executions_org_workflow_fk" FOREIGN KEY ("organization_id","workflow_id") REFERENCES "app"."automation_workflows"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."automation_executions" ADD CONSTRAINT "automation_executions_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."automation_executions" ADD CONSTRAINT "automation_executions_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."automation_workflows" ADD CONSTRAINT "automation_workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."automation_workflows" ADD CONSTRAINT "automation_workflows_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."business_booking_policies" ADD CONSTRAINT "business_booking_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_executions_once_uq" ON "app"."automation_executions" USING btree ("workflow_id","run_key");--> statement-breakpoint
CREATE INDEX "automation_executions_org_status_idx" ON "app"."automation_executions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "automation_workflows_org_active_idx" ON "app"."automation_workflows" USING btree ("organization_id","is_active");--> statement-breakpoint
ALTER TABLE "app"."automation_workflows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."automation_executions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."business_booking_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."automation_workflows" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."automation_executions" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."business_booking_policies" FROM PUBLIC;
