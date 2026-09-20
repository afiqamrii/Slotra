CREATE TABLE "app"."booking_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"event_type" varchar(20) DEFAULT 'STATUS_CHANGED' NOT NULL,
	"previous_status" varchar(24),
	"new_status" varchar(24) NOT NULL,
	"previous_start_at" timestamp with time zone,
	"previous_end_at" timestamp with time zone,
	"new_start_at" timestamp with time zone,
	"new_end_at" timestamp with time zone,
	"changed_by_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_history_event_ck" CHECK ("app"."booking_status_history"."event_type" in ('STATUS_CHANGED','RESCHEDULED'))
);
--> statement-breakpoint
CREATE TABLE "app"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid,
	"resource_id" uuid NOT NULL,
	"booking_reference" varchar(20) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" varchar(24) NOT NULL,
	"source" varchar(20) NOT NULL,
	"notes" text,
	"subtotal" integer NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"created_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_range_ck" CHECK ("app"."bookings"."end_at" > "app"."bookings"."start_at"),
	CONSTRAINT "bookings_status_ck" CHECK ("app"."bookings"."status" in ('PENDING','AWAITING_PAYMENT','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW','EXPIRED')),
	CONSTRAINT "bookings_source_ck" CHECK ("app"."bookings"."source" in ('ONLINE','STAFF','WALK_IN','IMPORT','API')),
	CONSTRAINT "bookings_money_ck" CHECK ("app"."bookings"."subtotal" >= 0 and "app"."bookings"."discount_amount" >= 0 and "app"."bookings"."tax_amount" >= 0 and "app"."bookings"."total_amount" = "app"."bookings"."subtotal" - "app"."bookings"."discount_amount" + "app"."bookings"."tax_amount" and "app"."bookings"."amount_paid" >= 0 and "app"."bookings"."amount_paid" <= "app"."bookings"."total_amount")
);
--> statement-breakpoint
ALTER TABLE "app"."resources" ADD COLUMN "minimum_advance_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."resources" ADD COLUMN "maximum_advance_days" integer;--> statement-breakpoint
ALTER TABLE "app"."booking_status_history" ADD CONSTRAINT "booking_status_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."booking_status_history" ADD CONSTRAINT "booking_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_org_id_uq" ON "app"."bookings" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."booking_status_history" ADD CONSTRAINT "booking_history_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_org_resource_fk" FOREIGN KEY ("organization_id","branch_id","resource_id") REFERENCES "app"."resources"("organization_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_id_uq" ON "app"."customers" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_org_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "app"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_history_org_booking_created_idx" ON "app"."booking_status_history" USING btree ("organization_id","booking_id","created_at");--> statement-breakpoint

CREATE UNIQUE INDEX "bookings_org_reference_uq" ON "app"."bookings" USING btree ("organization_id","booking_reference");--> statement-breakpoint
CREATE INDEX "bookings_org_branch_start_idx" ON "app"."bookings" USING btree ("organization_id","branch_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_org_resource_start_idx" ON "app"."bookings" USING btree ("organization_id","resource_id","start_at");--> statement-breakpoint

ALTER TABLE "app"."resources" ADD CONSTRAINT "resources_advance_ck" CHECK ("app"."resources"."minimum_advance_minutes" >= 0 and ("app"."resources"."maximum_advance_days" is null or "app"."resources"."maximum_advance_days" > 0));--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_active_resource_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "resource_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  ) WHERE ("status" IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS'));
--> statement-breakpoint
ALTER TABLE "app"."bookings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."booking_status_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."bookings", "app"."booking_status_history" FROM PUBLIC;


