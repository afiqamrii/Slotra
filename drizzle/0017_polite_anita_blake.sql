CREATE TABLE "app"."customer_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"remaining_credits_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_memberships_dates_ck" CHECK ("app"."customer_memberships"."ends_at" > "app"."customer_memberships"."starts_at"),
	CONSTRAINT "customer_memberships_status_ck" CHECK ("app"."customer_memberships"."status" in ('ACTIVE','PAUSED','EXPIRED','CANCELLED')),
	CONSTRAINT "customer_memberships_credits_ck" CHECK ("app"."customer_memberships"."remaining_credits_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."customer_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"total_minutes" integer NOT NULL,
	"remaining_minutes" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_packages_balance_ck" CHECK ("app"."customer_packages"."total_minutes" > 0 and "app"."customer_packages"."remaining_minutes" between 0 and "app"."customer_packages"."total_minutes"),
	CONSTRAINT "customer_packages_status_ck" CHECK ("app"."customer_packages"."status" in ('ACTIVE','EXPIRED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "app"."customer_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" varchar(40) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer NOT NULL,
	"billing_period" varchar(20) DEFAULT 'MONTHLY' NOT NULL,
	"discount_type" varchar(20) DEFAULT 'NONE' NOT NULL,
	"discount_value" integer DEFAULT 0 NOT NULL,
	"advance_days" integer,
	"monthly_credits_minutes" integer DEFAULT 0 NOT NULL,
	"sport_type_ids" jsonb,
	"resource_ids" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_price_ck" CHECK ("app"."membership_plans"."price_minor" >= 0 and "app"."membership_plans"."discount_value" >= 0 and "app"."membership_plans"."monthly_credits_minutes" >= 0 and ("app"."membership_plans"."advance_days" is null or "app"."membership_plans"."advance_days" between 1 and 365)),
	CONSTRAINT "membership_plans_period_ck" CHECK ("app"."membership_plans"."billing_period" in ('MONTHLY','ANNUAL')),
	CONSTRAINT "membership_plans_discount_ck" CHECK ("app"."membership_plans"."discount_type" in ('NONE','PERCENT','FIXED') and ("app"."membership_plans"."discount_type" <> 'PERCENT' or "app"."membership_plans"."discount_value" <= 100))
);
--> statement-breakpoint
CREATE TABLE "app"."package_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer NOT NULL,
	"credits_minutes" integer NOT NULL,
	"valid_days" integer,
	"sport_type_ids" jsonb,
	"resource_ids" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_plans_values_ck" CHECK ("app"."package_plans"."price_minor" >= 0 and "app"."package_plans"."credits_minutes" > 0 and ("app"."package_plans"."valid_days" is null or "app"."package_plans"."valid_days" > 0))
);
--> statement-breakpoint
CREATE TABLE "app"."package_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_package_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"status" varchar(20) DEFAULT 'APPLIED' NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_usages_minutes_ck" CHECK ("app"."package_usages"."minutes" > 0),
	CONSTRAINT "package_usages_status_ck" CHECK ("app"."package_usages"."status" in ('APPLIED','REVERSED'))
);
--> statement-breakpoint
CREATE TABLE "app"."pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sport_type_id" uuid NOT NULL,
	"resource_id" uuid,
	"name" text NOT NULL,
	"weekdays" integer[] NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_time_ck" CHECK ("app"."pricing_rules"."start_minute" >= 0 and "app"."pricing_rules"."start_minute" < "app"."pricing_rules"."end_minute" and "app"."pricing_rules"."end_minute" <= 1440),
	CONSTRAINT "pricing_rules_amount_ck" CHECK ("app"."pricing_rules"."amount_minor" >= 0),
	CONSTRAINT "pricing_rules_weekdays_ck" CHECK (cardinality("app"."pricing_rules"."weekdays") between 1 and 7 and "app"."pricing_rules"."weekdays" <@ array[0,1,2,3,4,5,6])
);
--> statement-breakpoint
CREATE TABLE "app"."promotion_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_id" uuid,
	"discount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_redemptions_discount_ck" CHECK ("app"."promotion_redemptions"."discount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"discount_type" varchar(20) NOT NULL,
	"discount_value" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"minimum_spend_minor" integer DEFAULT 0 NOT NULL,
	"maximum_discount_minor" integer,
	"usage_limit" integer,
	"per_customer_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"new_customer_only" boolean DEFAULT false NOT NULL,
	"sport_type_ids" jsonb,
	"resource_ids" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_window_ck" CHECK ("app"."promotions"."ends_at" > "app"."promotions"."starts_at"),
	CONSTRAINT "promotions_values_ck" CHECK ("app"."promotions"."discount_value" > 0 and "app"."promotions"."minimum_spend_minor" >= 0 and "app"."promotions"."used_count" >= 0 and ("app"."promotions"."usage_limit" is null or "app"."promotions"."usage_limit" > 0) and ("app"."promotions"."per_customer_limit" is null or "app"."promotions"."per_customer_limit" > 0) and ("app"."promotions"."maximum_discount_minor" is null or "app"."promotions"."maximum_discount_minor" > 0)),
	CONSTRAINT "promotions_type_ck" CHECK ("app"."promotions"."discount_type" in ('PERCENT','FIXED') and ("app"."promotions"."discount_type" <> 'PERCENT' or "app"."promotions"."discount_value" <= 100))
);
--> statement-breakpoint
CREATE TABLE "app"."recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"customer_id" uuid,
	"weekday" integer NOT NULL,
	"local_time" varchar(5) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"start_date" varchar(10) NOT NULL,
	"end_date" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_series_weekday_ck" CHECK ("app"."recurring_series"."weekday" between 0 and 6),
	CONSTRAINT "recurring_series_duration_ck" CHECK ("app"."recurring_series"."duration_minutes" > 0),
	CONSTRAINT "recurring_series_status_ck" CHECK ("app"."recurring_series"."status" in ('ACTIVE','CANCELLED')),
	CONSTRAINT "recurring_series_dates_ck" CHECK ("app"."recurring_series"."start_date" <= "app"."recurring_series"."end_date")
);
--> statement-breakpoint
CREATE TABLE "app"."waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"customer_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'WAITING' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_range_ck" CHECK ("app"."waitlist_entries"."end_at" > "app"."waitlist_entries"."start_at"),
	CONSTRAINT "waitlist_status_ck" CHECK ("app"."waitlist_entries"."status" in ('WAITING','NOTIFIED','FULFILLED','EXPIRED','CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD COLUMN "recurring_series_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_plans_org_id_uq" ON "app"."membership_plans" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_plans_org_id_uq" ON "app"."package_plans" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_packages_org_id_uq" ON "app"."customer_packages" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_org_id_uq" ON "app"."promotions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_series_org_id_uq" ON "app"."recurring_series" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."customer_memberships" ADD CONSTRAINT "customer_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_memberships" ADD CONSTRAINT "customer_memberships_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_memberships" ADD CONSTRAINT "customer_memberships_org_plan_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "app"."membership_plans"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_packages" ADD CONSTRAINT "customer_packages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_packages" ADD CONSTRAINT "customer_packages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_packages" ADD CONSTRAINT "customer_packages_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_packages" ADD CONSTRAINT "customer_packages_org_plan_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "app"."package_plans"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_tags" ADD CONSTRAINT "customer_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_tags" ADD CONSTRAINT "customer_tags_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_tags" ADD CONSTRAINT "customer_tags_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership_plans" ADD CONSTRAINT "membership_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."package_plans" ADD CONSTRAINT "package_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."package_usages" ADD CONSTRAINT "package_usages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."package_usages" ADD CONSTRAINT "package_usages_org_package_fk" FOREIGN KEY ("organization_id","customer_package_id") REFERENCES "app"."customer_packages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."package_usages" ADD CONSTRAINT "package_usages_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pricing_rules" ADD CONSTRAINT "pricing_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pricing_rules" ADD CONSTRAINT "pricing_rules_sport_type_id_sport_types_id_fk" FOREIGN KEY ("sport_type_id") REFERENCES "app"."sport_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pricing_rules" ADD CONSTRAINT "pricing_rules_org_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "app"."branches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pricing_rules" ADD CONSTRAINT "pricing_rules_org_resource_fk" FOREIGN KEY ("organization_id","branch_id","resource_id") REFERENCES "app"."resources"("organization_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_org_promo_fk" FOREIGN KEY ("organization_id","promotion_id") REFERENCES "app"."promotions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."promotions" ADD CONSTRAINT "promotions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recurring_series" ADD CONSTRAINT "recurring_series_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recurring_series" ADD CONSTRAINT "recurring_series_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recurring_series" ADD CONSTRAINT "recurring_series_org_resource_fk" FOREIGN KEY ("organization_id","branch_id","resource_id") REFERENCES "app"."resources"("organization_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recurring_series" ADD CONSTRAINT "recurring_series_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waitlist_entries" ADD CONSTRAINT "waitlist_org_resource_fk" FOREIGN KEY ("organization_id","branch_id","resource_id") REFERENCES "app"."resources"("organization_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."waitlist_entries" ADD CONSTRAINT "waitlist_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_memberships_org_id_uq" ON "app"."customer_memberships" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "customer_memberships_org_customer_idx" ON "app"."customer_memberships" USING btree ("organization_id","customer_id","status");--> statement-breakpoint
CREATE INDEX "customer_packages_org_customer_idx" ON "app"."customer_packages" USING btree ("organization_id","customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tags_org_customer_label_uq" ON "app"."customer_tags" USING btree ("organization_id","customer_id",lower("label"));--> statement-breakpoint
CREATE INDEX "customer_tags_org_label_idx" ON "app"."customer_tags" USING btree ("organization_id","label");--> statement-breakpoint
CREATE INDEX "membership_plans_org_active_idx" ON "app"."membership_plans" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "package_plans_org_active_idx" ON "app"."package_plans" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "package_usages_org_booking_uq" ON "app"."package_usages" USING btree ("organization_id","booking_id");--> statement-breakpoint
CREATE INDEX "package_usages_org_package_idx" ON "app"."package_usages" USING btree ("organization_id","customer_package_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_scope_idx" ON "app"."pricing_rules" USING btree ("organization_id","branch_id","sport_type_id","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_redemptions_org_booking_uq" ON "app"."promotion_redemptions" USING btree ("organization_id","booking_id");--> statement-breakpoint
CREATE INDEX "promotion_redemptions_org_customer_idx" ON "app"."promotion_redemptions" USING btree ("organization_id","promotion_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_org_code_uq" ON "app"."promotions" USING btree ("organization_id",upper("code"));--> statement-breakpoint
CREATE INDEX "promotions_org_active_idx" ON "app"."promotions" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "recurring_series_org_status_idx" ON "app"."recurring_series" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "waitlist_slot_idx" ON "app"."waitlist_entries" USING btree ("organization_id","resource_id","start_at","status");--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_org_series_fk" FOREIGN KEY ("organization_id","recurring_series_id") REFERENCES "app"."recurring_series"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."customer_packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."customer_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."membership_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."package_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."package_usages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."pricing_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."promotion_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."promotions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."recurring_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."waitlist_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."customer_memberships", "app"."customer_packages", "app"."customer_tags", "app"."membership_plans", "app"."package_plans", "app"."package_usages", "app"."pricing_rules", "app"."promotion_redemptions", "app"."promotions", "app"."recurring_series", "app"."waitlist_entries" FROM PUBLIC;
