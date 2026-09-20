CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(100) NOT NULL,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"state" text,
	"postcode" text,
	"country" varchar(2) DEFAULT 'MY' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_slug_format" CHECK ("app"."branches"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "app"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."operating_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"resource_id" uuid,
	"day_of_week" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operating_hours_day_ck" CHECK ("app"."operating_hours"."day_of_week" between 0 and 6),
	CONSTRAINT "operating_hours_range_ck" CHECK ("app"."operating_hours"."start_minute" between 0 and 1439 and "app"."operating_hours"."end_minute" > "app"."operating_hours"."start_minute" and "app"."operating_hours"."end_minute" <= 2880)
);
--> statement-breakpoint
CREATE TABLE "app"."organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_role_ck" CHECK ("app"."organization_members"."role" in ('OWNER','ADMIN','MANAGER','STAFF','VIEWER')),
	CONSTRAINT "organization_members_status_ck" CHECK ("app"."organization_members"."status" in ('ACTIVE','INVITED','SUSPENDED'))
);
--> statement-breakpoint
CREATE TABLE "app"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(100) NOT NULL,
	"logo_url" text,
	"primary_color" varchar(7),
	"timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
	"currency" varchar(3) DEFAULT 'MYR' NOT NULL,
	"locale" varchar(20) DEFAULT 'en-MY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_slug_format" CHECK ("app"."organizations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "app"."resource_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text,
	"type" varchar(20) DEFAULT 'MANUAL' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_blocks_range_ck" CHECK ("app"."resource_blocks"."end_at" > "app"."resource_blocks"."start_at"),
	CONSTRAINT "resource_blocks_type_ck" CHECK ("app"."resource_blocks"."type" in ('MANUAL','MAINTENANCE'))
);
--> statement-breakpoint
CREATE TABLE "app"."resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sport_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"display_type" varchar(40),
	"capacity" integer,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"image_url" text,
	"minimum_duration_minutes" integer DEFAULT 60 NOT NULL,
	"maximum_duration_minutes" integer,
	"booking_interval_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_status_ck" CHECK ("app"."resources"."status" in ('ACTIVE','MAINTENANCE','DISABLED')),
	CONSTRAINT "resources_capacity_ck" CHECK ("app"."resources"."capacity" is null or "app"."resources"."capacity" > 0),
	CONSTRAINT "resources_duration_ck" CHECK ("app"."resources"."minimum_duration_minutes" > 0 and ("app"."resources"."maximum_duration_minutes" is null or "app"."resources"."maximum_duration_minutes" >= "app"."resources"."minimum_duration_minutes") and "app"."resources"."booking_interval_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."sport_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "branches_org_id_uq" ON "app"."branches" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_org_branch_id_uq" ON "app"."resources" USING btree ("organization_id","branch_id","id");--> statement-breakpoint
ALTER TABLE "app"."branches" ADD CONSTRAINT "branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operating_hours" ADD CONSTRAINT "operating_hours_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operating_hours" ADD CONSTRAINT "operating_hours_org_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "app"."branches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operating_hours" ADD CONSTRAINT "operating_hours_org_resource_fk" FOREIGN KEY ("organization_id","branch_id","resource_id") REFERENCES "app"."resources"("organization_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resource_blocks" ADD CONSTRAINT "resource_blocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resource_blocks" ADD CONSTRAINT "resource_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resource_blocks" ADD CONSTRAINT "resource_blocks_org_resource_fk" FOREIGN KEY ("organization_id","branch_id","resource_id") REFERENCES "app"."resources"("organization_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resources" ADD CONSTRAINT "resources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resources" ADD CONSTRAINT "resources_sport_type_id_sport_types_id_fk" FOREIGN KEY ("sport_type_id") REFERENCES "app"."sport_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resources" ADD CONSTRAINT "resources_org_branch_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "app"."branches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_org_slug_uq" ON "app"."branches" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "branches_org_active_idx" ON "app"."branches" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "customers_org_phone_idx" ON "app"."customers" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE INDEX "customers_org_email_idx" ON "app"."customers" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "operating_hours_org_branch_day_idx" ON "app"."operating_hours" USING btree ("organization_id","branch_id","day_of_week");--> statement-breakpoint
CREATE INDEX "operating_hours_resource_day_idx" ON "app"."operating_hours" USING btree ("resource_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_uq" ON "app"."organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "app"."organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resource_blocks_resource_start_idx" ON "app"."resource_blocks" USING btree ("organization_id","resource_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_org_branch_name_uq" ON "app"."resources" USING btree ("organization_id","branch_id","name");--> statement-breakpoint
CREATE INDEX "resources_org_branch_status_idx" ON "app"."resources" USING btree ("organization_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "resources_sport_type_idx" ON "app"."resources" USING btree ("sport_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "app"."users" USING btree (lower("email"));--> statement-breakpoint
-- Private application schema. No browser/Data API roles are granted access.
REVOKE ALL ON SCHEMA "app" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE "app"."users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."organization_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."branches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."sport_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."resources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."operating_hours" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."resource_blocks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."customers" ENABLE ROW LEVEL SECURITY;
