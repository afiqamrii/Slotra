CREATE TABLE "app"."booking_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"period_start_at" timestamp with time zone NOT NULL,
	"period_end_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "booking_usage_period_ck" CHECK ("app"."booking_usage_records"."period_end_at" > "app"."booking_usage_records"."period_start_at")
);
--> statement-breakpoint
ALTER TABLE "app"."booking_usage_records" ADD CONSTRAINT "booking_usage_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."booking_usage_records" ADD CONSTRAINT "booking_usage_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_usage_org_booking_uq" ON "app"."booking_usage_records" USING btree ("organization_id","booking_id");--> statement-breakpoint
CREATE INDEX "booking_usage_org_period_idx" ON "app"."booking_usage_records" USING btree ("organization_id","period_start_at");
--> statement-breakpoint
INSERT INTO "app"."booking_usage_records" ("organization_id", "booking_id", "period_start_at", "period_end_at", "confirmed_at")
SELECT confirmed.organization_id, confirmed.booking_id,
  date_trunc('month', confirmed.confirmed_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
  (date_trunc('month', confirmed.confirmed_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC',
  confirmed.confirmed_at
FROM (
  SELECT organization_id, booking_id, min(created_at) AS confirmed_at
  FROM "app"."booking_status_history" WHERE new_status = 'CONFIRMED'
  GROUP BY organization_id, booking_id
) AS confirmed
ON CONFLICT ("organization_id", "booking_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "app"."booking_usage_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."booking_usage_records" FROM PUBLIC;
