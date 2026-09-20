CREATE TABLE "app"."organization_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_account_id" text NOT NULL,
	"status" varchar(20) DEFAULT 'CONNECTED' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_status_ck" CHECK ("app"."organization_payment_accounts"."status" in ('CONNECTED','DISCONNECTED','PENDING'))
);
--> statement-breakpoint
CREATE TABLE "app"."organization_payment_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"requirement" varchar(24) DEFAULT 'NO_UPFRONT' NOT NULL,
	"fixed_deposit_minor" integer,
	"deposit_percentage" integer,
	"manual_enabled" boolean DEFAULT true NOT NULL,
	"hold_minutes" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_settings_requirement_ck" CHECK ("app"."organization_payment_settings"."requirement" in ('NO_UPFRONT','FULL','FIXED_DEPOSIT','PERCENT_DEPOSIT')),
	CONSTRAINT "payment_settings_values_ck" CHECK (("app"."organization_payment_settings"."fixed_deposit_minor" is null or "app"."organization_payment_settings"."fixed_deposit_minor" > 0) and ("app"."organization_payment_settings"."deposit_percentage" is null or "app"."organization_payment_settings"."deposit_percentage" between 1 and 100) and "app"."organization_payment_settings"."hold_minutes" between 5 and 30)
);
--> statement-breakpoint
CREATE TABLE "app"."payment_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid,
	"payment_id" uuid,
	"actor_user_id" uuid,
	"action" varchar(60) NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_event_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider_account_id" uuid,
	"provider" varchar(40) NOT NULL,
	"provider_payment_id" text,
	"provider_reference" text,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"payment_method" varchar(30),
	"type" varchar(24) NOT NULL,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK ("app"."payments"."amount_minor" > 0),
	CONSTRAINT "payments_status_ck" CHECK ("app"."payments"."status" in ('PENDING','PROCESSING','PAID','FAILED','CANCELLED','PARTIALLY_REFUNDED','REFUNDED')),
	CONSTRAINT "payments_type_ck" CHECK ("app"."payments"."type" in ('FULL_PAYMENT','DEPOSIT','BALANCE_PAYMENT','MANUAL_PAYMENT'))
);
--> statement-breakpoint
CREATE TABLE "app"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider_refund_id" text,
	"amount_minor" integer NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_ck" CHECK ("app"."refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_status_ck" CHECK ("app"."refunds"."status" in ('PENDING','PROCESSING','SUCCEEDED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD COLUMN "payment_requirement" varchar(24) DEFAULT 'NO_UPFRONT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD COLUMN "required_now_minor" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD COLUMN "hold_expires_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_org_id_uq" ON "app"."organization_payment_accounts" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_id_uq" ON "app"."payments" USING btree ("organization_id","id");
--> statement-breakpoint
ALTER TABLE "app"."organization_payment_accounts" ADD CONSTRAINT "organization_payment_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."organization_payment_settings" ADD CONSTRAINT "organization_payment_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."payment_webhook_events" ADD CONSTRAINT "payment_events_org_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "app"."payments"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_org_account_fk" FOREIGN KEY ("organization_id","provider_account_id") REFERENCES "app"."organization_payment_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_org_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "app"."payments"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_org_provider_account_uq" ON "app"."organization_payment_accounts" USING btree ("organization_id","provider","provider_account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_one_default_uq" ON "app"."organization_payment_accounts" USING btree ("organization_id") WHERE "app"."organization_payment_accounts"."is_default" = true and "app"."organization_payment_accounts"."status" = 'CONNECTED';
--> statement-breakpoint
CREATE INDEX "payment_audit_org_created_idx" ON "app"."payment_audit_logs" USING btree ("organization_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_uq" ON "app"."payment_webhook_events" USING btree ("provider","provider_event_id");
--> statement-breakpoint
CREATE INDEX "payment_events_org_payment_idx" ON "app"."payment_webhook_events" USING btree ("organization_id","payment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_uq" ON "app"."payments" USING btree ("provider","provider_payment_id") WHERE "app"."payments"."provider_payment_id" is not null;
--> statement-breakpoint
CREATE INDEX "payments_org_booking_idx" ON "app"."payments" USING btree ("organization_id","booking_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_refund_uq" ON "app"."refunds" USING btree ("provider_refund_id") WHERE "app"."refunds"."provider_refund_id" is not null;
--> statement-breakpoint
CREATE INDEX "refunds_org_payment_idx" ON "app"."refunds" USING btree ("organization_id","payment_id");
--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_payment_snapshot_ck" CHECK ("app"."bookings"."payment_requirement" in ('NO_UPFRONT','FULL','FIXED_DEPOSIT','PERCENT_DEPOSIT') and "app"."bookings"."required_now_minor" between 0 and "app"."bookings"."total_amount");--> statement-breakpoint
ALTER TABLE "app"."bookings" DROP CONSTRAINT "bookings_active_resource_no_overlap";
--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_active_resource_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "resource_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  ) WHERE ("status" IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS') OR ("status" = 'AWAITING_PAYMENT' AND "hold_expires_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "app"."organization_payment_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."organization_payment_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."refunds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."payment_webhook_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."payment_audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."organization_payment_accounts", "app"."organization_payment_settings", "app"."payments", "app"."refunds", "app"."payment_webhook_events", "app"."payment_audit_logs" FROM PUBLIC;
