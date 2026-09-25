CREATE TABLE "app"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" varchar(100) NOT NULL,
	"key_prefix" varchar(24) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"actor_user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" uuid,
	"summary" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."corporate_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"billing_email" text NOT NULL,
	"contact_person" varchar(120),
	"billing_terms" varchar(200),
	"monthly_limit_minor" integer NOT NULL,
	"allow_overage" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_accounts_limit_ck" CHECK ("app"."corporate_accounts"."monthly_limit_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."corporate_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"period_start_at" timestamp with time zone NOT NULL,
	"amount_minor" integer NOT NULL,
	"status" varchar(20) DEFAULT 'APPLIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_charges_amount_ck" CHECK ("app"."corporate_charges"."amount_minor" >= 0),
	CONSTRAINT "corporate_charges_status_ck" CHECK ("app"."corporate_charges"."status" in ('APPLIED','REVERSED'))
);
--> statement-breakpoint
CREATE TABLE "app"."corporate_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."custom_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"base_role" varchar(20) NOT NULL,
	"permissions" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_roles_base_ck" CHECK ("app"."custom_roles"."base_role" in ('ADMIN','MANAGER','STAFF','VIEWER'))
);
--> statement-breakpoint
CREATE TABLE "app"."member_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."outbound_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"entity_id" uuid,
	"idempotency_key" varchar(150) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"verification_token_hash" varchar(64) NOT NULL,
	"verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_domains_status_ck" CHECK ("app"."tenant_domains"."status" in ('PENDING','VERIFYING','VERIFIED','FAILED','DISABLED')),
	CONSTRAINT "tenant_domains_active_verified_ck" CHECK (not "app"."tenant_domains"."is_active" or "app"."tenant_domains"."status" = 'VERIFIED')
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"response_status" integer,
	"error_summary" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_status_ck" CHECK ("app"."webhook_deliveries"."status" in ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
	CONSTRAINT "webhook_deliveries_attempt_count_ck" CHECK ("app"."webhook_deliveries"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"url" text NOT NULL,
	"event_types" jsonb NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_secret_version_ck" CHECK ("app"."webhook_endpoints"."secret_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."organization_members" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."organization_members" ADD COLUMN "branch_scope" varchar(10) DEFAULT 'ALL' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "hide_powered_by" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "public_description" text;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_id_uq" ON "app"."organization_members" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_accounts_org_id_uq" ON "app"."corporate_accounts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_org_id_uq" ON "app"."custom_roles" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_org_id_uq" ON "app"."webhook_endpoints" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_webhook_events_org_id_uq" ON "app"."outbound_webhook_events" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."api_keys" ADD CONSTRAINT "api_keys_org_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "app"."branches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_logs" ADD CONSTRAINT "audit_logs_org_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "app"."branches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."corporate_accounts" ADD CONSTRAINT "corporate_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."corporate_charges" ADD CONSTRAINT "corporate_charges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."corporate_charges" ADD CONSTRAINT "corporate_charges_org_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "app"."corporate_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."corporate_charges" ADD CONSTRAINT "corporate_charges_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."corporate_charges" ADD CONSTRAINT "corporate_charges_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."corporate_members" ADD CONSTRAINT "corporate_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."corporate_members" ADD CONSTRAINT "corporate_members_org_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "app"."corporate_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."corporate_members" ADD CONSTRAINT "corporate_members_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."custom_roles" ADD CONSTRAINT "custom_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."custom_roles" ADD CONSTRAINT "custom_roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."member_branches" ADD CONSTRAINT "member_branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."member_branches" ADD CONSTRAINT "member_branches_org_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "app"."organization_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."member_branches" ADD CONSTRAINT "member_branches_org_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "app"."branches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."outbound_webhook_events" ADD CONSTRAINT "outbound_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tenant_domains" ADD CONSTRAINT "tenant_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_org_endpoint_fk" FOREIGN KEY ("organization_id","endpoint_id") REFERENCES "app"."webhook_endpoints"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_org_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "app"."outbound_webhook_events"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "app"."api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_created_idx" ON "app"."api_keys" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "app"."audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_branch_created_idx" ON "app"."audit_logs" USING btree ("organization_id","branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_accounts_org_name_uq" ON "app"."corporate_accounts" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_charges_org_booking_uq" ON "app"."corporate_charges" USING btree ("organization_id","booking_id");--> statement-breakpoint
CREATE INDEX "corporate_charges_org_account_period_idx" ON "app"."corporate_charges" USING btree ("organization_id","account_id","period_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_members_org_account_customer_uq" ON "app"."corporate_members" USING btree ("organization_id","account_id","customer_id");--> statement-breakpoint
CREATE INDEX "corporate_members_org_customer_idx" ON "app"."corporate_members" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_org_name_uq" ON "app"."custom_roles" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "member_branches_org_member_branch_uq" ON "app"."member_branches" USING btree ("organization_id","member_id","branch_id");--> statement-breakpoint
CREATE INDEX "member_branches_org_branch_idx" ON "app"."member_branches" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_webhook_events_org_key_uq" ON "app"."outbound_webhook_events" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbound_webhook_events_org_created_idx" ON "app"."outbound_webhook_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_hostname_lower_uq" ON "app"."tenant_domains" USING btree (lower("hostname"));--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_org_id_uq" ON "app"."tenant_domains" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "tenant_domains_org_status_idx" ON "app"."tenant_domains" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_endpoint_uq" ON "app"."webhook_deliveries" USING btree ("event_id","endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_org_next_idx" ON "app"."webhook_deliveries" USING btree ("organization_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_active_idx" ON "app"."webhook_endpoints" USING btree ("organization_id","is_active");--> statement-breakpoint
ALTER TABLE "app"."organization_members" ADD CONSTRAINT "organization_members_custom_role_fk" FOREIGN KEY ("organization_id","custom_role_id") REFERENCES "app"."custom_roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_members" ADD CONSTRAINT "organization_members_branch_scope_ck" CHECK ("app"."organization_members"."branch_scope" in ('ALL','SELECTED'));
--> statement-breakpoint
ALTER TABLE "app"."api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."corporate_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."corporate_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."corporate_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."custom_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."member_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."outbound_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."tenant_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."api_keys", "app"."audit_logs", "app"."corporate_accounts", "app"."corporate_charges",
  "app"."corporate_members", "app"."custom_roles", "app"."member_branches", "app"."outbound_webhook_events",
  "app"."tenant_domains", "app"."webhook_deliveries", "app"."webhook_endpoints" FROM PUBLIC;
