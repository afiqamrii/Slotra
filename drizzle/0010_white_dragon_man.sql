ALTER TABLE "app"."bookings" DROP CONSTRAINT "bookings_payment_snapshot_ck";--> statement-breakpoint
ALTER TABLE "app"."payments" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint

CREATE UNIQUE INDEX "payments_org_id_booking_uq" ON "app"."payments" USING btree ("organization_id","id","booking_id");--> statement-breakpoint
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_payment_booking_fk" FOREIGN KEY ("organization_id","payment_id","booking_id") REFERENCES "app"."payments"("organization_id","id","booking_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_idempotency_uq" ON "app"."payments" USING btree ("organization_id","idempotency_key") WHERE "app"."payments"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_payment_snapshot_ck" CHECK ("app"."bookings"."payment_requirement" in ('NO_UPFRONT','FULL','FIXED_DEPOSIT','PERCENT_DEPOSIT') and "app"."bookings"."required_now_minor" between 0 and "app"."bookings"."total_amount" and ("app"."bookings"."required_now_minor" = 0 or "app"."bookings"."hold_expires_at" is not null));

