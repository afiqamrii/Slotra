CREATE TABLE "app"."notification_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"event_key" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"channel" varchar(20) DEFAULT 'EMAIL' NOT NULL,
	"recipient" text,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_type_ck" CHECK ("app"."notification_records"."type" in ('BOOKING_CONFIRMED','BOOKING_RESCHEDULED','BOOKING_CANCELLED')),
	CONSTRAINT "notification_status_ck" CHECK ("app"."notification_records"."status" in ('PENDING','SENT','FAILED','DEV_PREVIEW','SKIPPED'))
);
--> statement-breakpoint
ALTER TABLE "app"."notification_records" ADD CONSTRAINT "notification_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_records" ADD CONSTRAINT "notification_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_org_event_uq" ON "app"."notification_records" USING btree ("organization_id","event_key");--> statement-breakpoint
CREATE INDEX "notification_org_booking_idx" ON "app"."notification_records" USING btree ("organization_id","booking_id");
--> statement-breakpoint
ALTER TABLE "app"."notification_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."notification_records" FROM PUBLIC;
