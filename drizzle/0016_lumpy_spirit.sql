CREATE TABLE "app"."plan_upgrade_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"from_plan" varchar(20) NOT NULL,
	"target_plan" varchar(20) NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"provider" varchar(40) DEFAULT 'TOYYIBPAY_SANDBOX' NOT NULL,
	"provider_bill_code" varchar(40),
	"provider_reference" text,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_upgrade_status_ck" CHECK ("app"."plan_upgrade_attempts"."status" in ('PENDING','PROCESSING','PAID','FAILED','EXPIRED')),
	CONSTRAINT "plan_upgrade_amount_ck" CHECK ("app"."plan_upgrade_attempts"."amount_minor" > 0),
	CONSTRAINT "plan_upgrade_target_ck" CHECK ("app"."plan_upgrade_attempts"."from_plan" = 'STARTER' and "app"."plan_upgrade_attempts"."target_plan" = 'PROFESSIONAL')
);
--> statement-breakpoint
ALTER TABLE "app"."plan_upgrade_attempts" ADD CONSTRAINT "plan_upgrade_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."plan_upgrade_attempts" ADD CONSTRAINT "plan_upgrade_attempts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_upgrade_org_id_uq" ON "app"."plan_upgrade_attempts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_upgrade_bill_uq" ON "app"."plan_upgrade_attempts" USING btree ("provider","provider_bill_code") WHERE "app"."plan_upgrade_attempts"."provider_bill_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_upgrade_one_active_uq" ON "app"."plan_upgrade_attempts" USING btree ("organization_id") WHERE "app"."plan_upgrade_attempts"."status" in ('PENDING','PROCESSING');--> statement-breakpoint
CREATE INDEX "plan_upgrade_org_created_idx" ON "app"."plan_upgrade_attempts" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "app"."plan_upgrade_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."plan_upgrade_attempts" FROM PUBLIC;
