CREATE TABLE "app"."membership_credit_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_membership_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"status" varchar(20) DEFAULT 'APPLIED' NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_credit_minutes_ck" CHECK ("app"."membership_credit_usages"."minutes" > 0),
	CONSTRAINT "membership_credit_status_ck" CHECK ("app"."membership_credit_usages"."status" in ('APPLIED','REVERSED'))
);
--> statement-breakpoint
ALTER TABLE "app"."membership_credit_usages" ADD CONSTRAINT "membership_credit_usages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership_credit_usages" ADD CONSTRAINT "membership_credit_org_membership_fk" FOREIGN KEY ("organization_id","customer_membership_id") REFERENCES "app"."customer_memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership_credit_usages" ADD CONSTRAINT "membership_credit_org_booking_fk" FOREIGN KEY ("organization_id","booking_id") REFERENCES "app"."bookings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_credit_org_booking_uq" ON "app"."membership_credit_usages" USING btree ("organization_id","booking_id");--> statement-breakpoint
CREATE INDEX "membership_credit_org_membership_idx" ON "app"."membership_credit_usages" USING btree ("organization_id","customer_membership_id");--> statement-breakpoint
ALTER TABLE "app"."membership_credit_usages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "app"."membership_credit_usages" FROM PUBLIC;
