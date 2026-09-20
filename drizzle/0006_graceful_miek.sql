ALTER TABLE "app"."booking_status_history" ADD COLUMN "previous_resource_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."booking_status_history" ADD COLUMN "new_resource_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."booking_status_history" ADD COLUMN "previous_total_amount" integer;--> statement-breakpoint
ALTER TABLE "app"."booking_status_history" ADD COLUMN "new_total_amount" integer;