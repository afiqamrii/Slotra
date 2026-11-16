CREATE TABLE "app"."entitlement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"key" varchar(60) NOT NULL,
	"value" integer NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_override_kind_ck" CHECK ("app"."entitlement_overrides"."kind" in ('FEATURE','LIMIT') and "app"."entitlement_overrides"."value" >= 0 and ("app"."entitlement_overrides"."kind" <> 'FEATURE' or "app"."entitlement_overrides"."value" in (0,1)))
);
--> statement-breakpoint
CREATE TABLE "app"."organization_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_code" varchar(20) NOT NULL,
	"billing_cycle" varchar(10) DEFAULT 'MONTHLY' NOT NULL,
	"status" varchar(20) NOT NULL,
	"provider" varchar(40) DEFAULT 'NONE' NOT NULL,
	"provider_subscription_id" text,
	"provider_customer_id" text,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"pending_plan_code" varchar(20),
	"pending_billing_cycle" varchar(10),
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_plan_ck" CHECK ("app"."organization_subscriptions"."plan_code" in ('STARTER','PROFESSIONAL','BUSINESS','PRO') and ("app"."organization_subscriptions"."pending_plan_code" is null or "app"."organization_subscriptions"."pending_plan_code" in ('STARTER','PROFESSIONAL','BUSINESS','PRO'))),
	CONSTRAINT "subscriptions_cycle_ck" CHECK ("app"."organization_subscriptions"."billing_cycle" in ('MONTHLY','ANNUAL') and ("app"."organization_subscriptions"."pending_billing_cycle" is null or "app"."organization_subscriptions"."pending_billing_cycle" in ('MONTHLY','ANNUAL'))),
	CONSTRAINT "subscriptions_status_ck" CHECK ("app"."organization_subscriptions"."status" in ('TRIALING','ACTIVE','PAST_DUE','GRACE','CANCELLED','EXPIRED','SUSPENDED')),
	CONSTRAINT "subscriptions_period_ck" CHECK ("app"."organization_subscriptions"."current_period_end" > "app"."organization_subscriptions"."current_period_start" and ("app"."organization_subscriptions"."trial_end" is null or "app"."organization_subscriptions"."trial_end" > "app"."organization_subscriptions"."trial_start") and "app"."organization_subscriptions"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."subscription_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(80) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."subscription_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"target_plan_code" varchar(20) NOT NULL,
	"billing_cycle" varchar(10) NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'MYR' NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_checkout_id" text,
	"subscription_revision" integer NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_checkout_plan_ck" CHECK ("app"."subscription_checkouts"."target_plan_code" in ('STARTER','PROFESSIONAL','BUSINESS','PRO')),
	CONSTRAINT "subscription_checkout_cycle_ck" CHECK ("app"."subscription_checkouts"."billing_cycle" in ('MONTHLY','ANNUAL')),
	CONSTRAINT "subscription_checkout_amount_ck" CHECK ("app"."subscription_checkouts"."amount_minor" > 0),
	CONSTRAINT "subscription_checkout_status_ck" CHECK ("app"."subscription_checkouts"."status" in ('PENDING','SUCCEEDED','FAILED','EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "app"."subscription_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"type" varchar(80) NOT NULL,
	"recipient" text NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"provider_message_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_notification_status_ck" CHECK ("app"."subscription_notifications"."status" in ('PENDING','PROCESSING','SENT','DEV_PREVIEW','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "app"."subscription_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_event_id" varchar(200) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"outcome" varchar(20) DEFAULT 'APPLIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "lifecycle_status" varchar(20) DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "lifecycle_source" varchar(20) DEFAULT 'SUBSCRIPTION' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "platform_role" varchar(20) DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_audit_logs" ADD CONSTRAINT "subscription_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_audit_logs" ADD CONSTRAINT "subscription_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_checkouts" ADD CONSTRAINT "subscription_checkouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_checkouts" ADD CONSTRAINT "subscription_checkouts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_notifications" ADD CONSTRAINT "subscription_notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_provider_events" ADD CONSTRAINT "subscription_provider_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_override_org_expiry_idx" ON "app"."entitlement_overrides" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_uq" ON "app"."organization_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_id_uq" ON "app"."organization_subscriptions" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."subscription_checkouts" ADD CONSTRAINT "subscription_checkout_org_fk" FOREIGN KEY ("organization_id","subscription_id") REFERENCES "app"."organization_subscriptions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_id_uq" ON "app"."organization_subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_end_idx" ON "app"."organization_subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "subscription_audit_org_created_idx" ON "app"."subscription_audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_checkout_provider_uq" ON "app"."subscription_checkouts" USING btree ("provider","provider_checkout_id");--> statement-breakpoint
CREATE INDEX "subscription_checkout_org_created_idx" ON "app"."subscription_checkouts" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_notification_event_uq" ON "app"."subscription_notifications" USING btree ("organization_id","event_key","recipient");--> statement-breakpoint
CREATE INDEX "subscription_notification_pending_idx" ON "app"."subscription_notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_provider_event_uq" ON "app"."subscription_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "subscription_provider_event_org_idx" ON "app"."subscription_provider_events" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_lifecycle_ck" CHECK ("app"."organizations"."lifecycle_status" in ('ACTIVE','TRIAL','GRACE','SUSPENDED','CLOSED'));--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_lifecycle_source_ck" CHECK ("app"."organizations"."lifecycle_source" in ('SUBSCRIPTION','ADMIN'));--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_platform_role_ck" CHECK ("app"."users"."platform_role" in ('USER','SUPER_ADMIN'));
--> statement-breakpoint
INSERT INTO app.organization_subscriptions (organization_id, plan_code, status, provider, billing_cycle, current_period_start, current_period_end)
SELECT id, plan_code, 'ACTIVE', 'LEGACY', 'MONTHLY', date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
  (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'
FROM app.organizations;
--> statement-breakpoint
INSERT INTO app.subscription_audit_logs (organization_id, action, details)
SELECT id, 'legacy.plan_preserved', jsonb_build_object('plan', plan_code, 'provider', 'LEGACY') FROM app.organizations;
--> statement-breakpoint
ALTER TABLE app.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.subscription_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.subscription_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.subscription_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.entitlement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.subscription_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.organization_subscriptions, app.subscription_checkouts, app.subscription_provider_events,
  app.subscription_audit_logs, app.entitlement_overrides, app.subscription_notifications FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.organization_subscriptions, app.subscription_checkouts, app.subscription_provider_events,
      app.subscription_audit_logs, app.entitlement_overrides, app.subscription_notifications FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON app.organization_subscriptions, app.subscription_checkouts, app.subscription_provider_events,
      app.subscription_audit_logs, app.entitlement_overrides, app.subscription_notifications FROM authenticated;
  END IF;
END $$;
